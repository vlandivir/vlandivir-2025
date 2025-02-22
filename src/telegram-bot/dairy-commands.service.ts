import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';

@Injectable()
export class DairyCommandsService {
    constructor(
        private prisma: PrismaService,
        private dateParser: DateParserService
    ) {}

    async handleDairyCommand(ctx: Context) {
        const chatId = ctx.chat?.id;
        if (!chatId) return;

        const messageText = this.getCommandText(ctx);
        if (!messageText) return;

        const dateArg = messageText.split(' ').slice(1).join(' ').trim();
        
        try {
            const { date: parsedDate } = this.dateParser.extractDateFromFirstLine(dateArg || '');

            if (!dateArg) {
                const today = new Date();
                const previousYearsNotes = await this.getDairyNotesForDayMonth(chatId, today.getMonth(), today.getDate());
                await this.sendDairyNotesAllYears(ctx, previousYearsNotes, format(today, 'd MMMM', { locale: ru }));
            } else {
                if (!parsedDate) {
                    await ctx.reply('Не удалось распознать дату. Используйте форматы: DD.MM.YYYY, DD.MM, DD месяц');
                    return;
                }

                if (dateArg.includes(String(parsedDate.getFullYear()))) {
                    const notes = await this.getDairyNotes(chatId, parsedDate);
                    await this.sendDairyNotes(ctx, notes, format(parsedDate, 'd MMMM yyyy', { locale: ru }));
                } else {
                    const notes = await this.getDairyNotesForDayMonth(chatId, parsedDate.getMonth(), parsedDate.getDate());
                    await this.sendDairyNotesAllYears(ctx, notes, format(parsedDate, 'd MMMM', { locale: ru }));
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
                    lt: endOfDay(date)
                }
            },
            include: {
                images: true
            },
            orderBy: {
                noteDate: 'asc'
            }
        });
    }

    private async getDairyNotesForDayMonth(chatId: number, month: number, day: number) {
        const currentYear = new Date().getFullYear();
        const startYear = 1978;
        const years = Array.from(
            { length: currentYear - startYear + 1 },
            (_, i) => currentYear - i
        );

        const notesPromises = years.map(year => 
            this.prisma.note.findMany({
                where: {
                    chatId,
                    noteDate: {
                        gte: startOfDay(new Date(year, month, day)),
                        lt: endOfDay(new Date(year, month, day))
                    }
                },
                include: {
                    images: true
                },
                orderBy: {
                    noteDate: 'asc'
                }
            })
        );

        const allNotes = await Promise.all(notesPromises);

        return allNotes.reduce((acc, notes, index) => {
            const year = currentYear - index;
            if (notes.length > 0) {
                acc[year] = notes;
            }
            return acc;
        }, {} as Record<number, typeof allNotes[0]>);
    }

    private async sendDairyNotes(ctx: Context, notes: any[], dateStr: string) {
        if (notes.length === 0) {
            await ctx.reply(`Заметок за ${dateStr} не найдено`);
            return;
        }

        for (const note of notes) {
            if (note.images && note.images.length > 0) {
                for (const image of note.images) {
                    await ctx.replyWithPhoto(image.url, {
                        caption: note.content || undefined
                    });
                }
            } else {
                await ctx.reply(note.content);
            }
        }
    }

    private async sendDairyNotesAllYears(
        ctx: Context,
        notesByYear: Record<number, any[]>,
        dateStr: string
    ) {
        const years = Object.keys(notesByYear).sort((a, b) => Number(b) - Number(a));
        
        if (years.length === 0) {
            await ctx.reply(`Заметок за ${dateStr} не найдено`);
            return;
        }

        for (const year of years) {
            const notes = notesByYear[year];
            await ctx.reply(`${dateStr} ${year}:`);

            for (const note of notes) {
                if (note.images && note.images.length > 0) {
                    for (const image of note.images) {
                        await ctx.replyWithPhoto(image.url, {
                            caption: note.content || undefined
                        });
                    }
                } else {
                    await ctx.reply(note.content);
                }
            }
        }
    }
} 
