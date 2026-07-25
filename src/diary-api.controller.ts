import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { endOfDay, startOfDay } from 'date-fns';
import { GoogleSessionGuard } from './auth/google-session.guard';
import { PrismaService } from './prisma/prisma.service';

// The diary web app (/diary) reads and edits the owner's notes. There is a
// single diary chat — the owner's personal Telegram chat — so every query is
// scoped to this chat id (same constant the notifications API sends to).
const DIARY_CHAT_ID = 150847737n;

const FIRST_DIARY_YEAR = 1978;

type UpdateNoteBody = {
  content?: string;
};

// Owner-only diary API (page: /diary). Session only, like the email
// dashboard — there is no machine-key use case here.
@UseGuards(GoogleSessionGuard)
@Controller('diary-api')
export class DiaryApiController {
  constructor(private readonly prisma: PrismaService) {}

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
            images: { select: { url: true, description: true } },
            videos: { select: { url: true, description: true } },
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
}
