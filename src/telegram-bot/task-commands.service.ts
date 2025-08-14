import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { TaskEditWizardContext } from './scenes/task-edit.scene';
import { PrismaService } from '../prisma/prisma.service';
import { format, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { getUserTimeZone } from '../utils/timezone';
import { DateParserService } from '../services/date-parser.service';
import { StorageService } from '../services/storage.service';
import { LlmService } from '../services/llm.service';

interface ParsedTask {
  content: string;
  priority?: string;
  tags: string[];
  contexts: string[];
  projects: string[];
  dueDate?: Date;
  status?: string;
  snoozedUntil?: Date;
}

interface TaskImageCreateManyArgs {
  data: {
    key: string;
    chatId: number;
    url: string;
    description?: string | null;
  }[];
}

interface TaskImageFindManyArgs {
  where: { key: string; chatId: number };
  orderBy?: { createdAt: 'asc' | 'desc' };
}

interface TaskImageModel {
  createMany: (args: TaskImageCreateManyArgs) => Promise<unknown>;
  findMany: (
    args: TaskImageFindManyArgs,
  ) => Promise<{ url: string; description: string | null }[]>;
}

interface ImageFindManyArgs {
  where: { todoId: number };
  orderBy?: { createdAt: 'asc' | 'desc' };
}

interface ImageModel {
  findMany: (
    args: ImageFindManyArgs,
  ) => Promise<{ url: string; description?: string | null }[]>;
}

@Injectable()
export class TaskCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dateParser: DateParserService,
    private readonly storageService: StorageService,
    private readonly llmService: LlmService,
  ) {}

  private readonly editSessions: Map<
    number,
    {
      key: string;
      step: 'await_action' | 'await_snooze_days' | 'await_note' | 'await_image';
    }
  > = new Map();

  async handleTaskCommand(ctx: Context) {
    const text = this.getCommandText(ctx);
    if (!text) return;

    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('Unable to determine chat context');
      return;
    }

    const withoutCommand = text.replace(/^\/(t|task)\s*/, '').trim();
    if (!withoutCommand) {
      await ctx.reply(this.getTaskFormatMessage());
      return;
    }
    const parts = withoutCommand.split(/\s+/);
    let key: string | undefined;
    if (parts.length && /^T-\d{8}-\d+$/.test(parts[0])) {
      key = parts.shift() as string;
    }
    const tz = getUserTimeZone(ctx);
    const parsed = this.parseTask(parts.join(' '), tz);
    const parsedDueUtc = parsed.dueDate
      ? fromZonedTime(parsed.dueDate, tz)
      : undefined;
    const snoozedUntilUtc = parsed.snoozedUntil
      ? fromZonedTime(parsed.snoozedUntil, tz)
      : undefined;

    // Process images if present
    const images = await this.processTaskImages(ctx);

    if (key) {
      await this.editTask(ctx, key, parsed, images);
      return;
    }

    if (!parsed.content && images.length === 0) {
      await ctx.reply('Task text cannot be empty and no images provided');
      return;
    }

    const newKey = await this.generateKey(chatId);
    if (typeof this.prisma.$transaction === 'function') {
      await this.prisma.$transaction(async (tx) => {
        await tx.todo.create({
          data: {
            key: newKey,
            content: parsed.content,
            priority: parsed.priority,
            dueDate: parsedDueUtc,
            snoozedUntil: snoozedUntilUtc,
            tags: parsed.tags,
            contexts: parsed.contexts,
            projects: parsed.projects,
            status: parsed.status ?? 'new',
            chatId,
          },
        });
        const txTaskImage = (tx as unknown as { taskImage?: TaskImageModel })
          .taskImage;
        if (images.length > 0 && txTaskImage) {
          await txTaskImage.createMany({
            data: images.map((img) => ({
              key: newKey,
              chatId,
              url: img.url,
              description: img.description,
            })),
          });
        }
      });
    } else {
      await this.prisma.todo.create({
        data: {
          key: newKey,
          content: parsed.content,
          priority: parsed.priority,
          dueDate: parsedDueUtc,
          snoozedUntil: snoozedUntilUtc,
          tags: parsed.tags,
          contexts: parsed.contexts,
          projects: parsed.projects,
          status: parsed.status ?? 'new',
          chatId,
        },
      });
      const prismaTaskImageNew = (
        this.prisma as unknown as { taskImage?: TaskImageModel }
      ).taskImage;
      if (images.length > 0 && prismaTaskImageNew) {
        await prismaTaskImageNew.createMany({
          data: images.map((img) => ({
            key: newKey,
            chatId,
            url: img.url,
            description: img.description,
          })),
        });
      }
    }

    let response = `Task created with key ${newKey}`;
    if (images.length > 0) {
      response += `\nImages: ${images.length}`;
    }
    await ctx.reply(response);
  }

  private getCommandText(ctx: Context): string | undefined {
    if ('message' in ctx && ctx.message && 'text' in ctx.message) {
      return ctx.message.text;
    }
    if ('channelPost' in ctx && ctx.channelPost && 'text' in ctx.channelPost) {
      return ctx.channelPost.text;
    }
    return undefined;
  }

  private async downloadPhoto(filePath: string): Promise<Buffer> {
    const response = await fetch(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to download photo: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  public async processTaskImages(
    ctx: Context,
  ): Promise<{ url: string; description: string }[]> {
    const images: { url: string; description: string }[] = [];

    if (!ctx.message || !('photo' in ctx.message)) {
      return images;
    }

    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) {
      return images;
    }

    // Use only the highest quality version to avoid duplicates
    const photo = photos.reduce(
      (best, p) => {
        const bestSize = best.file_size ?? best.width * best.height;
        const currSize = p.file_size ?? p.width * p.height;
        return currSize > bestSize ? p : best;
      },
      photos[photos.length - 1],
    );

    try {
      const file = await ctx.telegram.getFile(photo.file_id);
      const photoBuffer = await this.downloadPhoto(file.file_path!);
      const photoUrl = await this.storageService.uploadFile(
        photoBuffer,
        'image/jpeg',
        ctx.chat?.id || 0,
      );

      const imageDescription = await this.llmService.describeImage(
        photoBuffer,
        'caption' in ctx.message ? ctx.message.caption : undefined,
      );

      images.push({
        url: photoUrl,
        description: imageDescription,
      });
    } catch (error) {
      console.error('Error processing task image:', error);
    }

    return images;
  }

  public async getLatestTask(key: string, chatId: number) {
    return this.prisma.todo.findFirst({
      where: { key, chatId },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async getTaskImagesByKey(key: string, chatId: number) {
    return this.prisma.taskImage.findMany({
      where: { key, chatId },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async getTaskNotes(key: string, chatId: number) {
    return this.prisma.taskNote.findMany({
      where: { key, chatId },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async createTaskNote(key: string, content: string, chatId: number) {
    return this.prisma.taskNote.create({
      data: {
        key,
        content,
        chatId,
      },
    });
  }

  private parseFilters(text: string): {
    tags: string[];
    contexts: string[];
    projects: string[];
    remaining: string[];
  } {
    const tokens = text.split(/\s+/).filter((t) => t);
    const tags: string[] = [];
    const contexts: string[] = [];
    const projects: string[] = [];
    const remaining: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('@')) {
        tags.push(token.slice(1));
        continue;
      }
      if (token.startsWith('.')) {
        contexts.push(token.slice(1));
        continue;
      }
      if (token.startsWith('!')) {
        let project = token.slice(1);
        while (
          i + 1 < tokens.length &&
          !tokens[i + 1].startsWith('@') &&
          !tokens[i + 1].startsWith('.') &&
          !tokens[i + 1].startsWith('!') &&
          !tokens[i + 1].startsWith(':') &&
          !/^\([a-zA-Z]\)$/.test(tokens[i + 1])
        ) {
          project += ` ${tokens[i + 1]}`;
          i++;
        }
        projects.push(project);
        continue;
      }
      remaining.push(token);
    }
    return { tags, contexts, projects, remaining };
  }

  public parseTask(text: string, timeZone?: string): ParsedTask {
    const { tags, contexts, projects, remaining } = this.parseFilters(text);
    const tokens = remaining;
    let priority: string | undefined;
    let dueDate: Date | undefined;
    let status: string | undefined;
    let snoozedUntil: Date | undefined;
    const descParts: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('-')) {
        const st = token.slice(1);
        if (['canceled', 'done', 'in-progress', 'started'].includes(st)) {
          status = st;
          continue;
        }
        // Handle -snoozed[number] syntax (e.g., -snoozed4)
        const snoozedMatch = /^snoozed(\d+)$/.exec(st);
        if (snoozedMatch) {
          status = 'snoozed';
          const days = parseInt(snoozedMatch[1], 10);
          const tz = timeZone || 'UTC';
          const nowZoned = toZonedTime(new Date(), tz);
          const localNow = new Date(
            nowZoned.getFullYear(),
            nowZoned.getMonth(),
            nowZoned.getDate(),
            nowZoned.getHours(),
            nowZoned.getMinutes(),
            nowZoned.getSeconds(),
            nowZoned.getMilliseconds(),
          );
          localNow.setDate(localNow.getDate() + days);
          snoozedUntil = localNow;
          continue;
        }
        // Handle -snoozed followed by a separate number token (e.g., -snoozed 4)
        if (
          st === 'snoozed' &&
          i + 1 < tokens.length &&
          /^\d+$/.test(tokens[i + 1])
        ) {
          status = 'snoozed';
          const days = parseInt(tokens[i + 1], 10);
          const tz = timeZone || 'UTC';
          const nowZoned = toZonedTime(new Date(), tz);
          const localNow = new Date(
            nowZoned.getFullYear(),
            nowZoned.getMonth(),
            nowZoned.getDate(),
            nowZoned.getHours(),
            nowZoned.getMinutes(),
            nowZoned.getSeconds(),
            nowZoned.getMilliseconds(),
          );
          localNow.setDate(localNow.getDate() + days);
          snoozedUntil = localNow;
          i++; // Skip the next token since we consumed it
          continue;
        }
      }
      if (/^\([a-zA-Z]\)$/.test(token)) {
        priority = token.slice(1, 2).toUpperCase();
        continue;
      }
      if (token.startsWith(':')) {
        let dateStr = token.slice(1);
        if (i + 1 < tokens.length && /^\d{1,2}:\d{2}$/.test(tokens[i + 1])) {
          dateStr += ` ${tokens[i + 1]}`;
          i++;
        }
        const parsed = this.parseDueDate(dateStr, timeZone || 'UTC');
        if (parsed) {
          dueDate = parsed;
        }
        continue;
      }
      descParts.push(token);
    }
    return {
      content: descParts.join(' ').trim(),
      priority,
      tags,
      contexts,
      projects,
      dueDate,
      status,
      snoozedUntil,
    };
  }

  private parseDueDate(text: string, timeZone: string): Date | undefined {
    const timeMatch = /(\d{1,2}:\d{2})$/.exec(text);
    const datePart = timeMatch
      ? text.replace(timeMatch[0], '').trim()
      : text.trim();

    let date: Date | undefined =
      this.dateParser.extractDateFromFirstLine(datePart).date || undefined;
    if (!date) {
      date = this.parseRelativeDate(datePart, timeZone);
    }
    if (!date) return undefined;

    if (timeMatch) {
      const [h, m] = timeMatch[1].split(':').map(Number);
      date.setHours(h, m, 0, 0);
    }

    return date;
  }

  private parseRelativeDate(text: string, timeZone: string): Date | undefined {
    const lower = text.toLowerCase();
    const nowZoned = toZonedTime(new Date(), timeZone);
    const today = new Date(
      nowZoned.getFullYear(),
      nowZoned.getMonth(),
      nowZoned.getDate(),
      0,
      0,
      0,
      0,
    );

    if (['today', 'сегодня'].includes(lower)) {
      return today;
    }
    if (['tomorrow', 'завтра'].includes(lower)) {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return d;
    }

    const days: Record<string, number> = {
      sunday: 0,
      sun: 0,
      воскресенье: 0,
      вс: 0,
      monday: 1,
      mon: 1,
      понедельник: 1,
      пн: 1,
      tuesday: 2,
      tue: 2,
      вторник: 2,
      вт: 2,
      wednesday: 3,
      wed: 3,
      среда: 3,
      ср: 3,
      thursday: 4,
      thu: 4,
      четверг: 4,
      чт: 4,
      friday: 5,
      fri: 5,
      пятница: 5,
      пт: 5,
      saturday: 6,
      sat: 6,
      суббота: 6,
      сб: 6,
    };

    if (days[lower] !== undefined) {
      let diff = (days[lower] - nowZoned.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      return d;
    }

    return undefined;
  }

  public async editTask(
    ctx: Context,
    key: string,
    updates: ParsedTask,
    images: { url: string; description: string }[] = [],
  ) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('Unable to determine chat context');
      return;
    }

    const existing = await this.prisma.todo.findFirst({
      where: {
        key,
        chatId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) {
      await ctx.reply(`Task with key ${key} not found in this chat`);
      return;
    }

    const tz = getUserTimeZone(ctx);
    const dueUtc = updates.dueDate
      ? fromZonedTime(updates.dueDate, tz)
      : undefined;

    if (typeof this.prisma.$transaction === 'function') {
      await this.prisma.$transaction(async (tx) => {
        await tx.todo.create({
          data: {
            key,
            content: updates.content || existing.content,
            priority: updates.priority ?? existing.priority,
            dueDate: dueUtc ?? existing.dueDate,
            snoozedUntil: updates.snoozedUntil ?? existing.snoozedUntil,
            tags: Array.from(new Set([...existing.tags, ...updates.tags])),
            contexts: Array.from(
              new Set([...existing.contexts, ...updates.contexts]),
            ),
            projects:
              updates.projects.length > 0
                ? updates.projects
                : existing.projects,
            status: updates.status ?? existing.status,
            chatId,
          },
        });

        // Add new TaskImages for this update
        const txTaskImageEdit = (
          tx as unknown as { taskImage?: TaskImageModel }
        ).taskImage;
        if (images.length > 0 && txTaskImageEdit) {
          await txTaskImageEdit.createMany({
            data: images.map((img) => ({
              key,
              chatId,
              url: img.url,
              description: img.description,
            })),
          });
        }
      });
    } else {
      await this.prisma.todo.create({
        data: {
          key,
          content: updates.content || existing.content,
          priority: updates.priority ?? existing.priority,
          dueDate: dueUtc ?? existing.dueDate,
          snoozedUntil: updates.snoozedUntil ?? existing.snoozedUntil,
          tags: Array.from(new Set([...existing.tags, ...updates.tags])),
          contexts: Array.from(
            new Set([...existing.contexts, ...updates.contexts]),
          ),
          projects:
            updates.projects.length > 0 ? updates.projects : existing.projects,
          status: updates.status ?? existing.status,
          chatId,
        },
      });
      // Add new TaskImages for this update (if model is available)
      const prismaTaskImageEdit = (
        this.prisma as unknown as { taskImage?: TaskImageModel }
      ).taskImage;
      if (images.length > 0 && prismaTaskImageEdit) {
        await prismaTaskImageEdit.createMany({
          data: images.map((img) => ({
            key,
            chatId,
            url: img.url,
            description: img.description,
          })),
        });
      }
    }

    let response = `Task ${key} updated`;
    if (images.length > 0) {
      response += `\nImages: ${images.length}`;
    }
    await ctx.reply(response);
  }

  private async generateKey(chatId: number): Promise<string> {
    const today = new Date();
    const datePart = format(today, 'yyyyMMdd');
    const count = await this.prisma.todo.count({
      where: {
        createdAt: { gte: startOfDay(today), lt: endOfDay(today) },
        chatId,
      },
    });
    const index = count + 1;
    const indexStr = index.toString().padStart(2, '0');
    return `T-${datePart}-${indexStr}`;
  }

  async handleListCommand(ctx: Context) {
    const text = this.getCommandText(ctx) || '';
    const withoutCommand = text.replace(/^\/tl\s*/, '').trim();
    const { tags, contexts, projects } = this.parseFilters(withoutCommand);

    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('Unable to determine chat context');
      return;
    }

    // Build the complete query as a template literal
    let query = `
            WITH latest_todos AS (
                SELECT *,
                       ROW_NUMBER() OVER (PARTITION BY key ORDER BY id DESC) as rn
                FROM "Todo"
                WHERE "chatId" = ${chatId}
            )
            SELECT id, key, content, "createdAt", status, "completedAt", priority, "dueDate", "snoozedUntil", tags, contexts, projects
            FROM latest_todos
            WHERE rn = 1 
              AND status NOT IN ('done', 'canceled')
              AND (status != 'snoozed' OR "snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())`;

    if (tags.length > 0) {
      query += ` AND tags @> '${JSON.stringify(tags)}'::jsonb`;
    }

    if (contexts.length > 0) {
      query += ` AND contexts @> '${JSON.stringify(contexts)}'::jsonb`;
    }

    if (projects.length > 0) {
      query += ` AND projects @> '${JSON.stringify(projects)}'::jsonb`;
    }

    query += ` ORDER BY "dueDate" IS NULL, "dueDate" ASC, "createdAt" DESC, key ASC`;

    // Use CTE to get latest record for each key, then apply filters
    const latestTasks = await this.prisma.$queryRawUnsafe<
      {
        id: number;
        key: string;
        content: string;
        createdAt: Date;
        status: string;
        completedAt: Date | null;
        priority: string | null;
        dueDate: Date | null;
        snoozedUntil: Date | null;
        tags: string[];
        contexts: string[];
        projects: string[];
      }[]
    >(query);

    // Get images for each task by key
    const tasksWithImages = await Promise.all(
      latestTasks.map(async (task) => {
        let images: { url: string; description?: string | null }[] = [];
        const prismaTaskImageList = (
          this.prisma as unknown as { taskImage?: TaskImageModel }
        ).taskImage;
        if (prismaTaskImageList) {
          images = await prismaTaskImageList.findMany({
            where: { key: task.key, chatId },
            orderBy: { createdAt: 'asc' },
          });
        } else if ((this.prisma as unknown as { image?: ImageModel }).image) {
          // Fallback for older schema/tests expecting image.findMany by todoId
          images = await (
            this.prisma as unknown as { image: ImageModel }
          ).image.findMany({
            where: { todoId: task.id },
            orderBy: { createdAt: 'asc' },
          });
        }
        return { ...task, images };
      }),
    );

    if (tasksWithImages.length === 0) {
      await ctx.reply('No tasks found in this chat');
      return;
    }

    const lines: string[] = [];
    const buttons: { text: string; callback_data: string }[][] = [];
    let row: { text: string; callback_data: string }[] = [];

    const from = (ctx as Context & { from?: { time_zone?: string } }).from;
    const envTz = process.env.USER_TIME_ZONE;
    const tz = from?.time_zone || envTz || 'UTC';
    const source = from?.time_zone ? 'telegram' : envTz ? 'env' : 'default';
    const now = toZonedTime(new Date(), tz);

    for (const t of tasksWithImages) {
      let prefix = '';
      if (t.dueDate) {
        let icon = '📅';
        if (t.dueDate.getTime() < new Date().getTime()) {
          icon = '❗';
        } else {
          const dueLocal = toZonedTime(t.dueDate, tz);
          if (isSameDay(dueLocal, now)) {
            icon = '⏰';
          }
        }
        prefix = `${icon} `;
      }

      let line = `${prefix}${t.key} ${t.content}`;
      if (t.dueDate) {
        line += ` (due: ${formatInTimeZone(
          t.dueDate,
          tz,
          'MMM d, yyyy HH:mm',
        )})`;
      }
      if (t.images && t.images.length > 0) {
        line += ` 📷(${t.images.length})`;
      }
      lines.push(line);
      row.push({ text: t.key, callback_data: `edit_task_${t.key}` });
      if (row.length === 2) {
        buttons.push(row);
        row = [];
      }
    }
    if (row.length > 0) {
      buttons.push(row);
    }

    const offset = formatInTimeZone(new Date(), tz, 'XXX');
    lines.push('', `Time zone: ${tz} (UTC${offset}) — source: ${source}`);
    await ctx.reply(lines.join('\n'), {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  isEditing(chatId: number): boolean {
    return this.editSessions.has(chatId);
  }

  async startEditConversation(ctx: Context, key: string) {
    await (ctx as TaskEditWizardContext).scene?.enter?.('taskEditScene', {
      key,
    });
  }

  async handleEditCallback(ctx: Context, action: string) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return;
    const session = this.editSessions.get(chatId);
    if (!session) return;
    await ctx.answerCbQuery();
    await (
      ctx as Context & {
        editMessageReplyMarkup?: (
          markup: InlineKeyboardMarkup | undefined,
        ) => Promise<void>;
      }
    ).editMessageReplyMarkup?.(undefined);
    if (action === 'done' || action === 'canceled') {
      await this.editTask(ctx, session.key, {
        content: '',
        tags: [],
        contexts: [],
        projects: [],
        status: action,
      });
      this.editSessions.delete(chatId);
      return;
    }
    if (action === 'snoozed') {
      session.step = 'await_snooze_days';
      this.editSessions.set(chatId, session);
      await ctx.reply('How many days to snooze?');
    } else if (action === 'add_todo_note') {
      session.step = 'await_note';
      this.editSessions.set(chatId, session);
      await ctx.reply('Please send note text');
    } else if (action === 'add_todo_image') {
      session.step = 'await_image';
      this.editSessions.set(chatId, session);
      await ctx.reply('Please send image(s)');
    }
  }

  async handleEditText(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const session = this.editSessions.get(chatId);
    if (!session) return false;

    // Handle photo messages
    if (ctx.message && 'photo' in ctx.message) {
      if (session.step === 'await_action') {
        const images = await this.processTaskImages(ctx);
        if (images.length > 0) {
          await this.editTask(
            ctx,
            session.key,
            {
              content: '',
              tags: [],
              contexts: [],
              projects: [],
            },
            images,
          );
          this.editSessions.delete(chatId);
          return true;
        }
      } else if (session.step === 'await_image') {
        const images = await this.processTaskImages(ctx);
        if (images.length > 0) {
          await this.editTask(
            ctx,
            session.key,
            {
              content: '',
              tags: [],
              contexts: [],
              projects: [],
            },
            images,
          );
          session.step = 'await_action';
          this.editSessions.set(chatId, session);
          await ctx.reply('Images added to task');
          await this.startEditConversation(ctx, session.key);
          return true;
        }
      }
      return true;
    }

    // Handle text messages
    if (!ctx.message || !('text' in ctx.message)) return true;
    const text = ctx.message.text.trim();
    if (session.step === 'await_snooze_days') {
      const days = parseInt(text, 10);
      if (Number.isNaN(days)) {
        await ctx.reply('Please provide number of days');
        return true;
      }
      const tz = getUserTimeZone(ctx);
      const nowZoned = toZonedTime(new Date(), tz);
      const snoozedUntil = new Date(
        nowZoned.getFullYear(),
        nowZoned.getMonth(),
        nowZoned.getDate(),
        nowZoned.getHours(),
        nowZoned.getMinutes(),
        nowZoned.getSeconds(),
        nowZoned.getMilliseconds(),
      );
      snoozedUntil.setDate(snoozedUntil.getDate() + days);
      await this.editTask(ctx, session.key, {
        content: '',
        tags: [],
        contexts: [],
        projects: [],
        status: 'snoozed',
        snoozedUntil,
      });
      this.editSessions.delete(chatId);
      return true;
    }
    if (session.step === 'await_note') {
      await this.prisma.taskNote.create({
        data: { key: session.key, content: text, chatId },
      });
      session.step = 'await_action';
      this.editSessions.set(chatId, session);
      await ctx.reply('Note added');
      await this.startEditConversation(ctx, session.key);
      return true; // Explicit return to prevent fallthrough
    }
    if (session.step !== 'await_action') {
      console.warn(`Unknown edit session step: ${session.step}`);
      return true;
    }
    const tz = getUserTimeZone(ctx);
    const parsed = this.parseTask(text, tz);
    await this.editTask(ctx, session.key, parsed);
    this.editSessions.delete(chatId);
    return true;
  }

  private getTaskFormatMessage(): string {
    return [
      'Format:',
      '/t [T-YYYYMMDD-NN] (-status) @tag .context !project (A) :<date> text',
      'Status options: -done, -canceled, -in-progress, -started, -snoozed[days] or -snoozed [days]',
      'Example: /task (B) @work .office !Big Project :2025.07.31 09:00 Prepare report',
      'Snooze examples: /task T-20250715-01 -snoozed4 or /task T-20250715-01 -snoozed 4',
      '',
      'You can also send images with your task to add them as notes.',
    ].join('\n');
  }
}
