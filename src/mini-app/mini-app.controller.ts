import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { validate, parse } from '@telegram-apps/init-data-node';
import type { Response } from 'express';
import { StorageService } from '../services/storage.service';
import { TimeZoneCacheService } from '../services/timezone-cache.service';
import { formatInTimeZone } from 'date-fns-tz';

type TelegramInitData = ReturnType<typeof parse>;

@Controller('mini-app-api')
export class MiniAppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly tzCache: TimeZoneCacheService,
  ) {}

  // Index HTML is now served by static frontend under `/mini-app` via Vite build.

  @Get('user')
  async getUser(
    @Query('initData') initData?: string,
    @Query('tz') tz?: string,
  ) {
    try {
      const parsed = this.parseAndVerifyInitData(initData || '');
      const userId = parsed.user?.id;
      if (!userId) return { error: 'No user' };

      // userId is number; in DB chatId is BigInt. Use BigInt for filtering
      const chatId = BigInt(userId);
      const [notes, todos, questions, answers] = await Promise.all([
        this.prisma.note.count({ where: { chatId } }),
        this.prisma.todo.count({ where: { chatId } }),
        this.prisma.question.count({ where: { chatId } }),
        this.prisma.answer.count(),
      ]);

      const userSummary = [
        parsed.user?.firstName,
        parsed.user?.lastName,
        parsed.user?.username ? '(' + parsed.user?.username + ')' : undefined,
      ]
        .filter(Boolean)
        .join(' ');

      const initials =
        (
          (parsed.user?.firstName?.[0] || '') +
          (parsed.user?.lastName?.[0] || '')
        ).toUpperCase() ||
        parsed.user?.username?.slice(0, 2).toUpperCase() ||
        'U';

      const tzFromUser = undefined;
      let resolvedTz = 'UTC';
      let tzSource: 'web' | 'telegram' | 'cache' | 'default' = 'default';
      if (tz) {
        resolvedTz = tz;
        tzSource = 'web';
      } else if (tzFromUser) {
        resolvedTz = tzFromUser;
        tzSource = 'telegram';
      } else {
        const cached = this.tzCache.getTimeZone(userId);
        if (cached) {
          resolvedTz = cached;
          tzSource = 'cache';
        }
      }
      if (userId && resolvedTz) this.tzCache.setTimeZone(userId, resolvedTz);
      const utcOffset = formatInTimeZone(new Date(), resolvedTz, 'XXX');
      return {
        userId,
        userSummary,
        username: parsed.user?.username || null,
        initials,
        hasAvatar: true, // actual presence checked in avatar endpoint; keep true to try load
        counts: { notes, todos, questions, answers },
        timeZone: resolvedTz,
        timeZoneSource: tzSource,
        utcOffset,
      };
    } catch (e) {
      return { error: `Invalid initData ${e}` };
    }
  }

  @Get('avatar')
  @Header('Cache-Control', 'public, max-age=300')
  async avatar(@Query('userId') userIdParam: string, @Res() res: Response) {
    try {
      const userId = Number(userIdParam);
      if (!userId) {
        res.status(400).send('Bad userId');
        return;
      }
      const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
      if (!token) {
        res.status(500).send('No token');
        return;
      }
      const apiBase = `https://api.telegram.org/bot${token}`;
      const photosResp = await fetch(
        `${apiBase}/getUserProfilePhotos?user_id=${userId}&limit=1`,
      );
      const photosJson = (await photosResp.json()) as {
        ok: boolean;
        result?: {
          total_count: number;
          photos: Array<Array<{ file_id: string }>>;
        };
      };
      if (
        !photosJson.ok ||
        !photosJson.result ||
        photosJson.result.total_count === 0
      ) {
        res.status(404).send('No avatar');
        return;
      }
      const sizes = photosJson.result.photos[0];
      const fileId = sizes[sizes.length - 1].file_id;

      const fileResp = await fetch(`${apiBase}/getFile?file_id=${fileId}`);
      const fileJson = (await fileResp.json()) as {
        ok: boolean;
        result?: { file_path: string };
      };
      if (!fileJson.ok || !fileJson.result) {
        res.status(404).send('No file');
        return;
      }
      const filePath = fileJson.result.file_path;
      const imgResp = await fetch(
        `https://api.telegram.org/file/bot${token}/${filePath}`,
      );
      const buffer = Buffer.from(await imgResp.arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(buffer);
    } catch (e) {
      res.status(500).send(`Error ${e}`);
    }
  }

  @Get('image')
  @Header('Cache-Control', 'public, max-age=300')
  async image(
    @Res() res: Response,
    @Query('initData') initData?: string,
    @Query('imageId') imageId?: string,
  ) {
    try {
      const parsed = this.parseAndVerifyInitData(initData || '');
      const userId = parsed.user?.id;
      if (!userId) {
        res.status(400).send('No user');
        return;
      }
      const id = Number(imageId);
      if (!id) {
        res.status(400).send('Bad imageId');
        return;
      }
      const chatId = BigInt(userId);
      const image = await this.prisma.taskImage.findFirst({
        where: { id, chatId },
      });
      if (!image) {
        res.status(404).send('Not found');
        return;
      }
      const buffer = await this.storage.downloadFile(image.url);
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(buffer);
    } catch (e) {
      res.status(500).send(`Error ${e}`);
    }
  }

  @Get('todos')
  async getTodos(
    @Query('initData') initData?: string,
    @Query('tz') tz?: string,
  ) {
    try {
      const parsed = this.parseAndVerifyInitData(initData || '');
      const userId = parsed.user?.id;
      if (!userId) return { error: 'No user' };
      const chatId = BigInt(userId);
      const query = `
            WITH latest_todos AS (
                SELECT *,
                       ROW_NUMBER() OVER (PARTITION BY key ORDER BY id DESC) as rn
                FROM "Todo"
                WHERE "chatId" = ${chatId}
            )
            SELECT id, key, content, "dueDate", status, "snoozedUntil"
            FROM latest_todos
            WHERE rn = 1
              AND status NOT IN ('done', 'canceled')
              AND (status != 'snoozed' OR "snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())
            ORDER BY "dueDate" IS NULL, "dueDate" ASC, "createdAt" DESC, key ASC`;
      const tasks = await this.prisma.$queryRawUnsafe<
        {
          id: number;
          key: string;
          content: string;
          dueDate: Date | null;
          status: string;
          snoozedUntil: Date | null;
        }[]
      >(query);
      const cachedTz = this.tzCache.getTimeZone(userId);
      const timeZone = tz || cachedTz || 'UTC';
      return tasks.map((t) => ({
        ...t,
        dueDate: t.dueDate
          ? formatInTimeZone(t.dueDate, timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX")
          : null,
        snoozedUntil: t.snoozedUntil
          ? formatInTimeZone(
              t.snoozedUntil,
              timeZone,
              "yyyy-MM-dd'T'HH:mm:ssXXX",
            )
          : null,
      }));
    } catch (e) {
      return { error: `Invalid initData ${e}` };
    }
  }

  @Get('todo')
  async getTodo(
    @Query('initData') initData?: string,
    @Query('key') key?: string,
    @Query('tz') tz?: string,
  ) {
    try {
      const parsed = this.parseAndVerifyInitData(initData || '');
      const userId = parsed.user?.id;
      if (!userId) return { error: 'No user' };
      if (!key) return { error: 'No key' };
      const chatId = BigInt(userId);
      const todo = await this.prisma.todo.findFirst({
        where: { key, chatId },
        orderBy: { id: 'desc' },
        select: {
          key: true,
          content: true,
          createdAt: true,
          status: true,
          completedAt: true,
          priority: true,
          dueDate: true,
          snoozedUntil: true,
          tags: true,
          contexts: true,
          projects: true,
        },
      });
      if (!todo) return { error: 'Not found' };
      const [notes, images, history] = await Promise.all([
        this.prisma.taskNote.findMany({
          where: { key, chatId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, content: true },
        }),
        this.prisma.taskImage.findMany({
          where: { key, chatId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, description: true },
        }),
        this.prisma.todo.findMany({
          where: { key, chatId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            key: true,
            content: true,
            createdAt: true,
            status: true,
            completedAt: true,
            priority: true,
            dueDate: true,
            snoozedUntil: true,
            tags: true,
            contexts: true,
            projects: true,
          },
        }),
      ]);
      const initEncoded = encodeURIComponent(initData || '');
      const cachedTz = this.tzCache.getTimeZone(userId);
      const timeZone = tz || cachedTz || 'UTC';
      const mapRecord = (r: {
        [key: string]: unknown;
        createdAt?: Date | null;
        completedAt?: Date | null;
        dueDate?: Date | null;
        snoozedUntil?: Date | null;
      }) => ({
        ...r,
        createdAt: r.createdAt
          ? formatInTimeZone(r.createdAt, timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX")
          : null,
        completedAt: r.completedAt
          ? formatInTimeZone(
              r.completedAt,
              timeZone,
              "yyyy-MM-dd'T'HH:mm:ssXXX",
            )
          : null,
        dueDate: r.dueDate
          ? formatInTimeZone(r.dueDate, timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX")
          : null,
        snoozedUntil: r.snoozedUntil
          ? formatInTimeZone(
              r.snoozedUntil,
              timeZone,
              "yyyy-MM-dd'T'HH:mm:ssXXX",
            )
          : null,
      });
      return {
        todo: mapRecord(todo),
        notes,
        images: images.map((img) => ({
          id: img.id,
          description: img.description,
          url: `/mini-app-api/image?initData=${initEncoded}&imageId=${img.id}`,
        })),
        history: history.map(mapRecord),
      };
    } catch (e) {
      return { error: `Invalid initData ${e}` };
    }
  }

  private parseAndVerifyInitData(raw: string): TelegramInitData {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('No token');
    // Validate signature (throws on invalid/expired by default)
    validate(raw, token);
    return parse(raw);
  }
}
