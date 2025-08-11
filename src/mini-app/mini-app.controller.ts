import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { Response } from 'express';
import { StorageService } from '../services/storage.service';

type TelegramInitData = {
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  chat_type?: string;
  chat_instance?: string;
  auth_date?: string;
  hash: string;
};

@Controller('mini-app-api')
export class MiniAppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  // Index HTML is now served by static frontend under `/mini-app` via Vite build.

  @Get('user')
  async getUser(@Query('initData') initData?: string) {
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
        parsed.user?.first_name,
        parsed.user?.last_name,
        parsed.user?.username ? '(' + parsed.user?.username + ')' : undefined,
      ]
        .filter(Boolean)
        .join(' ');

      const initials =
        (
          (parsed.user?.first_name?.[0] || '') +
          (parsed.user?.last_name?.[0] || '')
        ).toUpperCase() ||
        parsed.user?.username?.slice(0, 2).toUpperCase() ||
        'U';

      return {
        userId,
        userSummary,
        username: parsed.user?.username || null,
        initials,
        hasAvatar: true, // actual presence checked in avatar endpoint; keep true to try load
        counts: { notes, todos, questions, answers },
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
    @Query('initData') initData?: string,
    @Query('imageId') imageId?: string,
    @Res() res: Response,
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
  async getTodos(@Query('initData') initData?: string) {
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
        }[]
      >(query);
      return tasks;
    } catch (e) {
      return { error: `Invalid initData ${e}` };
    }
  }

  @Get('todo')
  async getTodo(
    @Query('initData') initData?: string,
    @Query('key') key?: string,
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
        select: { key: true, content: true, dueDate: true },
      });
      if (!todo) return { error: 'Not found' };
      const [notes, images] = await Promise.all([
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
      ]);
      const initEncoded = encodeURIComponent(initData || '');
      return {
        todo,
        notes,
        images: images.map((img) => ({
          id: img.id,
          description: img.description,
          url: `/mini-app-api/image?initData=${initEncoded}&imageId=${img.id}`,
        })),
      };
    } catch (e) {
      return { error: `Invalid initData ${e}` };
    }
  }

  private parseAndVerifyInitData(raw: string): TelegramInitData {
    // Based on https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('No token');
    const urlParams = new URLSearchParams(raw);
    const hash = urlParams.get('hash') || '';
    const dataCheckString = Array.from(urlParams.entries())
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    if (calculatedHash !== hash) throw new Error('Bad hash');

    const result: TelegramInitData = { hash } as TelegramInitData;
    const userString = urlParams.get('user');
    if (userString) {
      try {
        result.user = JSON.parse(userString);
      } catch {
        // ignore
      }
    }
    result.auth_date = urlParams.get('auth_date') || undefined;
    result.chat_type = urlParams.get('chat_type') || undefined;
    result.chat_instance = urlParams.get('chat_instance') || undefined;
    return result;
  }
}
