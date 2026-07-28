import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { endOfDay, startOfDay } from 'date-fns';
import { GoogleSessionGuard } from './auth/google-session.guard';
import { DIARY_CHAT_ID } from './diary.constants';
import { PrismaService } from './prisma/prisma.service';
import { LlmService } from './services/llm.service';
import { StorageService } from './services/storage.service';

const FIRST_DIARY_YEAR = 1978;

// LlmService.describeImage never throws — on failure it returns one of these
// Russian sentinels. We must not persist those as a real description.
const DESCRIBE_FAILURE_SENTINELS = [
  'Не удалось описать изображение',
  'Не удалось получить описание от OpenAI',
  'Превышено время ожидания ответа от OpenAI',
  'Ошибка конфигурации API ключа',
  'Ошибка API OpenAI',
  'Неожиданный формат ответа от OpenAI',
  'Модель отказалась описать изображение',
  'Ошибка при обработке ответа от OpenAI',
];

type UpdateNoteBody = {
  content?: string;
};

type UpdateImageBody = {
  description?: string;
};

// Owner-only diary API (page: /diary). Session only, like the email
// dashboard — there is no machine-key use case here.
@UseGuards(GoogleSessionGuard)
@Controller('diary-api')
export class DiaryApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly storageService: StorageService,
  ) {}

  // Which day-of-month cells have at least one note (any year), for the
  // year-agnostic calendar. Month/day are 1-indexed.
  @Get('calendar')
  async calendar() {
    const rows = await this.prisma.$queryRaw<
      { month: number; day: number; count: number }[]
    >`
      SELECT
        EXTRACT(MONTH FROM "noteDate")::int AS month,
        EXTRACT(DAY FROM "noteDate")::int AS day,
        COUNT(*)::int AS count
      FROM "Note"
      WHERE "chatId" = ${DIARY_CHAT_ID}
      GROUP BY month, day
      ORDER BY month, day
    `;
    return { days: rows };
  }

  // All notes for one day-of-month across every year, newest year first.
  @Get('day')
  async day(
    @Query('month') monthArg: string | undefined,
    @Query('day') dayArg: string | undefined,
  ) {
    const month = Number(monthArg);
    const day = Number(dayArg);
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > 31
    ) {
      throw new BadRequestException('month (1-12) and day (1-31) are required');
    }

    const currentYear = new Date().getFullYear();
    const years = Array.from(
      { length: currentYear - FIRST_DIARY_YEAR + 1 },
      (_, i) => currentYear - i,
    );

    const notesByYear = await Promise.all(
      years.map((year) => {
        const target = new Date(year, month - 1, day);
        return this.prisma.note.findMany({
          where: {
            chatId: DIARY_CHAT_ID,
            noteDate: {
              gte: startOfDay(target),
              lt: endOfDay(target),
            },
          },
          orderBy: { noteDate: 'asc' },
          select: {
            id: true,
            content: true,
            noteDate: true,
            images: { select: { id: true, url: true, description: true } },
            videos: { select: { id: true, url: true, description: true } },
          },
        });
      }),
    );

    const result = years
      .map((year, index) => ({ year, notes: notesByYear[index] }))
      .filter((entry) => entry.notes.length > 0);

    return { month, day, years: result };
  }

  // Edit a note's text (media stays untouched). Scoped to the diary chat so
  // only the owner's notes can be edited.
  @Patch('notes/:id')
  async updateNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateNoteBody,
  ) {
    if (typeof body?.content !== 'string') {
      throw new BadRequestException('content is required');
    }
    const content = body.content;

    const updated = await this.prisma.note.updateMany({
      where: { id, chatId: DIARY_CHAT_ID },
      data: { content },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Note not found');
    }

    // Drop the stale search vector; the lazy indexer (DiarySearchService)
    // re-embeds the note on the next search.
    await this.prisma.embedding.deleteMany({
      where: { kind: 'note', refId: id },
    });

    return { id, content };
  }

  // Edit an image's description (e.g. correct a poor auto-transcription).
  // Scoped to the diary chat via the image's parent note.
  @Patch('images/:id')
  async updateImage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateImageBody,
  ) {
    if (typeof body?.description !== 'string') {
      throw new BadRequestException('description is required');
    }
    const description = body.description;

    const updated = await this.prisma.image.updateMany({
      where: { id, note: { chatId: DIARY_CHAT_ID } },
      data: { description },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Image not found');
    }

    await this.prisma.embedding.deleteMany({
      where: { kind: 'image', refId: id },
    });

    return { id, description };
  }

  // Re-run the image description with handwriting-aware recognition plus a
  // text post-processing pass, then persist and return it.
  @Post('images/:id/describe')
  async describeImage(@Param('id', ParseIntPipe) id: number) {
    const image = await this.prisma.image.findFirst({
      where: { id, note: { chatId: DIARY_CHAT_ID } },
      select: { id: true, url: true, note: { select: { content: true } } },
    });
    if (!image) {
      throw new NotFoundException('Image not found');
    }

    let buffer: Buffer;
    try {
      buffer = await this.storageService.downloadFile(image.url);
    } catch {
      throw new ServiceUnavailableException('Failed to download image');
    }

    const noteContext = image.note?.content?.trim() || undefined;
    const raw = await this.llmService.describeImage(
      buffer,
      undefined,
      noteContext,
      {
        handwriting: true,
        reasoningEffort: 'medium',
      },
    );
    if (DESCRIBE_FAILURE_SENTINELS.includes(raw.trim())) {
      throw new ServiceUnavailableException(raw.trim());
    }

    const description = await this.llmService.refineHandwrittenText(
      raw,
      noteContext,
    );

    await this.prisma.image.update({
      where: { id },
      data: { description },
    });
    await this.prisma.embedding.deleteMany({
      where: { kind: 'image', refId: id },
    });

    return { id, description };
  }

  // Edit a video's description. Scoped to the diary chat via the parent note.
  // Videos aren't part of the RAG index, so there's no embedding to drop.
  @Patch('videos/:id')
  async updateVideo(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateImageBody,
  ) {
    if (typeof body?.description !== 'string') {
      throw new BadRequestException('description is required');
    }
    const description = body.description;

    const updated = await this.prisma.video.updateMany({
      where: { id, note: { chatId: DIARY_CHAT_ID } },
      data: { description },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Video not found');
    }

    return { id, description };
  }
}
