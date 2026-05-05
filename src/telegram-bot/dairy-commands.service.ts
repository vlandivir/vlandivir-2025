import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { DebugLogService } from '../services/debug-log.service';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';

@Injectable()
export class DairyCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dateParser: DateParserService,
    private readonly debugLogService: DebugLogService,
  ) {}

  async handleDairyCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const messageText = this.getCommandText(ctx);
    if (!messageText) return;

    const dateArg = messageText.split(' ').slice(1).join(' ').trim();

    try {
      const { date: parsedDate } = this.dateParser.extractDateFromFirstLine(
        dateArg || '',
      );

      if (!dateArg) {
        const today = new Date();
        const previousYearsNotes = await this.getDairyNotesForDayMonth(
          chatId,
          today.getMonth(),
          today.getDate(),
        );
        await this.sendDairyNotesAllYears(
          ctx,
          previousYearsNotes,
          format(today, 'd MMMM', { locale: ru }),
        );
      } else {
        if (!parsedDate) {
          await ctx.reply(
            'Не удалось распознать дату. Используйте форматы: DD.MM.YYYY, DD.MM, DD месяц',
          );
          return;
        }

        if (dateArg.includes(String(parsedDate.getFullYear()))) {
          const notes = await this.getDairyNotes(chatId, parsedDate);
          await this.sendDairyNotes(
            ctx,
            notes,
            format(parsedDate, 'd MMMM yyyy', { locale: ru }),
          );
        } else {
          const notes = await this.getDairyNotesForDayMonth(
            chatId,
            parsedDate.getMonth(),
            parsedDate.getDate(),
          );
          await this.sendDairyNotesAllYears(
            ctx,
            notes,
            format(parsedDate, 'd MMMM', { locale: ru }),
          );
        }
      }
    } catch (error) {
      console.error('Error handling dairy command:', error);
      await ctx.reply('Произошла ошибка при получении заметок');
    }
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

  private async getDairyNotes(chatId: number, date: Date) {
    return await this.prisma.note.findMany({
      where: {
        chatId,
        noteDate: {
          gte: startOfDay(date),
          lt: endOfDay(date),
        },
      },
      include: {
        images: true,
        videos: true,
      },
      orderBy: {
        noteDate: 'asc',
      },
    });
  }

  private async getDairyNotesForDayMonth(
    chatId: number,
    month: number,
    day: number,
  ) {
    const currentYear = new Date().getFullYear();
    const startYear = 1978;
    const years = Array.from(
      { length: currentYear - startYear + 1 },
      (_, i) => currentYear - i,
    );

    const notesPromises = years.map((year) =>
      this.prisma.note.findMany({
        where: {
          chatId,
          noteDate: {
            gte: startOfDay(new Date(year, month, day)),
            lt: endOfDay(new Date(year, month, day)),
          },
        },
        include: {
          images: true,
          videos: true,
        },
        orderBy: {
          noteDate: 'asc',
        },
      }),
    );

    const allNotes = await Promise.all(notesPromises);

    return allNotes.reduce<Record<number, (typeof allNotes)[0]>>(
      (acc, notes, index) => {
        const year = currentYear - index;
        if (notes.length > 0) {
          acc[year] = notes;
        }
        return acc;
      },
      {},
    );
  }

  private async sendDairyNotes(
    ctx: Context,
    notes: {
      content: string | null;
      images: { url: string }[];
      videos: { url: string }[];
    }[],
    dateStr: string,
  ) {
    if (notes.length === 0) {
      await ctx.reply(`Заметок за ${dateStr} не найдено`);
      return;
    }

    for (const note of notes) {
      let hasMedia = false;
      if (note.images && note.images.length > 0) {
        hasMedia = true;
        for (const image of note.images) {
          await ctx.replyWithPhoto(image.url, {
            caption: note.content || undefined,
          });
        }
      }
      if (note.videos && note.videos.length > 0) {
        hasMedia = true;
        this.debugLogService.info('dairy-send', 'Sending videos from /d', {
          chatId: ctx.chat?.id,
          videosCount: note.videos.length,
        });
        // #region agent log
        fetch(
          'http://127.0.0.1:7651/ingest/2258b12e-88c5-48b5-93f6-d9873e1c1f96',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': '1f338d',
            },
            body: JSON.stringify({
              sessionId: '1f338d',
              runId: 'pre-fix',
              hypothesisId: 'H5',
              location: 'dairy-commands.service.ts:176',
              message: 'Sending videos in /d output',
              data: {
                chatId: ctx.chat?.id,
                videosCount: note.videos.length,
                hasText: !!note.content,
              },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
        for (const video of note.videos) {
          try {
            await ctx.replyWithVideo(video.url, {
              caption: note.content || undefined,
            });
          } catch (e) {
            this.debugLogService.warn(
              'dairy-send',
              'replyWithVideo failed, falling back to URL',
              {
                chatId: ctx.chat?.id,
                videoUrl: video.url,
                error: e instanceof Error ? e.message : 'unknown',
              },
            );
            // #region agent log
            fetch(
              'http://127.0.0.1:7651/ingest/2258b12e-88c5-48b5-93f6-d9873e1c1f96',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Debug-Session-Id': '1f338d',
                },
                body: JSON.stringify({
                  sessionId: '1f338d',
                  runId: 'pre-fix',
                  hypothesisId: 'H5',
                  location: 'dairy-commands.service.ts:186',
                  message: 'replyWithVideo failed, fallback to URL',
                  data: {
                    chatId: ctx.chat?.id,
                    videoUrl: video.url,
                    error: e instanceof Error ? e.message : 'unknown',
                  },
                  timestamp: Date.now(),
                }),
              },
            ).catch(() => {});
            // #endregion
            console.warn(
              'Failed to send video via Telegram, falling back to URL',
              e,
            );
            const caption = note.content
              ? `⚠️ ${note.content}\n\n(Ссылка на видео: ${video.url})`
              : `⚠️ Ссылка на видео: ${video.url}`;
            await ctx.reply(caption);
          }
        }
      }
      if (!hasMedia) {
        await ctx.reply(note.content || '');
      }
    }
  }

  private async sendDairyNotesAllYears(
    ctx: Context,
    notesByYear: Record<
      number,
      {
        content: string | null;
        images: { url: string }[];
        videos: { url: string }[];
      }[]
    >,
    dateStr: string,
  ) {
    const years = Object.keys(notesByYear).sort(
      (a, b) => Number(b) - Number(a),
    );

    if (years.length === 0) {
      await ctx.reply(`Заметок за ${dateStr} не найдено`);
      return;
    }

    for (const year of years) {
      const notes = notesByYear[year] as {
        content: string | null;
        images: { url: string }[];
        videos: { url: string }[];
      }[];
      await ctx.reply(`${dateStr} ${year}:`);

      for (const note of notes) {
        let hasMedia = false;
        if (note.images && note.images.length > 0) {
          hasMedia = true;
          for (const image of note.images) {
            await ctx.replyWithPhoto(image.url, {
              caption: note.content || undefined,
            });
          }
        }
        if (note.videos && note.videos.length > 0) {
          hasMedia = true;
          for (const video of note.videos) {
            try {
              await ctx.replyWithVideo(video.url, {
                caption: note.content || undefined,
              });
            } catch (e) {
              console.warn(
                'Failed to send video via Telegram (all years), falling back to URL',
                e,
              );
              const caption = note.content
                ? `⚠️ ${note.content}\n\n(Ссылка на видео: ${video.url})`
                : `⚠️ Ссылка на видео: ${video.url}`;
              await ctx.reply(caption);
            }
          }
        }
        if (!hasMedia) {
          await ctx.reply(note.content || '');
        }
      }
    }
  }
}
