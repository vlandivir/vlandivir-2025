import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { PrismaService } from '../prisma/prisma.service';
import { format, startOfDay, endOfDay, isToday } from 'date-fns';
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
    { key: string; step: 'await_action' | 'await_snooze_days' | 'await_note' }
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
    const parsed = this.parseTask(parts.join(' '));

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
    await this.prisma.todo.create({
      data: {
        key: newKey,
        content: parsed.content,
        priority: parsed.priority,
        dueDate: parsed.dueDate,
        snoozedUntil: parsed.snoozedUntil,
        tags: parsed.tags,
        contexts: parsed.contexts,
        projects: parsed.projects,
        status: parsed.status ?? 'new',
        chatId,
        images: {
          create: images.map(img => ({
            url: img.url,
            description: img.description,
          })),
        },
      },
    });
    
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
    const response = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Failed to download photo: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async processTaskImages(ctx: Context): Promise<{ url: string; description: string }[]> {
    const images: { url: string; description: string }[] = [];
    
    if (!ctx.message || !('photo' in ctx.message)) {
      return images;
    }

    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) {
      return images;
    }

    for (const photo of photos) {
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
    }

    return images;
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

  private parseTask(text: string): ParsedTask {
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
          snoozedUntil = new Date();
          snoozedUntil.setDate(snoozedUntil.getDate() + days);
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
          snoozedUntil = new Date();
          snoozedUntil.setDate(snoozedUntil.getDate() + days);
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
        const parsed = this.parseDueDate(dateStr);
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

  private parseDueDate(text: string): Date | undefined {
    const timeMatch = /(\d{1,2}:\d{2})$/.exec(text);
    const datePart = timeMatch
      ? text.replace(timeMatch[0], '').trim()
      : text.trim();

    let date: Date | undefined =
      this.dateParser.extractDateFromFirstLine(datePart).date || undefined;
    if (!date) {
      date = this.parseRelativeDate(datePart);
    }
    if (!date) return undefined;

    if (timeMatch) {
      const [h, m] = timeMatch[1].split(':').map(Number);
      date.setHours(h, m, 0, 0);
    }

    return date;
  }

  private parseRelativeDate(text: string): Date | undefined {
    const lower = text.toLowerCase();
    const today = startOfDay(new Date());

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
      let diff = (days[lower] - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      return d;
    }

    return undefined;
  }

  private async editTask(ctx: Context, key: string, updates: ParsedTask, images: { url: string; description: string }[] = []) {
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

    const data = {
      key,
      content: updates.content || existing.content,
      priority: updates.priority ?? existing.priority,
      dueDate: updates.dueDate ?? existing.dueDate,
      snoozedUntil: updates.snoozedUntil ?? existing.snoozedUntil,
      tags: Array.from(new Set([...existing.tags, ...updates.tags])),
      contexts: Array.from(
        new Set([...existing.contexts, ...updates.contexts]),
      ),
      projects:
        updates.projects.length > 0 ? updates.projects : existing.projects,
      status: updates.status ?? existing.status,
      chatId,
      images: {
        create: images.map(img => ({
          url: img.url,
          description: img.description,
        })),
      },
    };

    await this.prisma.todo.create({ data });
    
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

    // Get images for each task
    const tasksWithImages = await Promise.all(
      latestTasks.map(async (task) => {
        const images = await this.prisma.image.findMany({
          where: { todoId: task.id },
          orderBy: { createdAt: 'asc' },
        });
        return { ...task, images };
      })
    );

    if (tasksWithImages.length === 0) {
      await ctx.reply('No tasks found in this chat');
      return;
    }

    const lines: string[] = [];
    const buttons: { text: string; callback_data: string }[][] = [];
    let row: { text: string; callback_data: string }[] = [];

    const now = new Date();

    for (const t of tasksWithImages) {
      let prefix = '';
      if (t.dueDate) {
        let icon = '📅';
        if (t.dueDate.getTime() < now.getTime()) {
          icon = '❗';
        } else if (isToday(t.dueDate)) {
          icon = '⏰';
        }
        prefix = `${icon} `;
      }

      let line = `${prefix}${t.key} ${t.content}`;
      if (t.dueDate) {
        line += ` (due: ${format(t.dueDate, 'MMM d, yyyy HH:mm')})`;
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

    await ctx.reply(lines.join('\n'), {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  isEditing(chatId: number): boolean {
    return this.editSessions.has(chatId);
  }

  async startEditConversation(ctx: Context, key: string) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return;
    this.editSessions.set(chatId, { key, step: 'await_action' });
    await ctx.answerCbQuery?.();
    await (
      ctx as Context & {
        editMessageReplyMarkup?: (
          markup: InlineKeyboardMarkup | undefined,
        ) => Promise<void>;
      }
    ).editMessageReplyMarkup?.(undefined);
    
    // Get the latest task with images
    const latestTask = await this.prisma.todo.findFirst({
      where: { key, chatId },
      orderBy: { createdAt: 'desc' },
      include: { images: true },
    });
    
    const notes = await this.prisma.taskNote.findMany({
      where: { key, chatId },
      orderBy: { createdAt: 'asc' },
    });
    const noteLines = notes.map((n) => `- ${n.content}`).join('\n');
    let text = `Editing ${key}. Send updates or choose status`;
    if (notes.length) {
      text += `\n\nNotes:\n${noteLines}`;
    }
    if (latestTask?.images && latestTask.images.length > 0) {
      text += `\n\nImages: ${latestTask.images.length}`;
    }
    await ctx.reply(text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Done', callback_data: 'edit_status_done' },
            { text: 'Canceled', callback_data: 'edit_status_canceled' },
          ],
          [{ text: 'Snooze', callback_data: 'edit_status_snoozed' }],
          [{ text: 'Add note', callback_data: 'edit_add_note' }],
        ],
      },
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
    } else if (action === 'add_note') {
      session.step = 'await_note';
      this.editSessions.set(chatId, session);
      await ctx.reply('Please send note text');
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
          await this.editTask(ctx, session.key, {
            content: '',
            tags: [],
            contexts: [],
            projects: [],
          }, images);
          this.editSessions.delete(chatId);
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
      const snoozedUntil = new Date();
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
    const parsed = this.parseTask(text);
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
