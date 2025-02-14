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
        if (!chatId || !ctx.message) return;

        const messageText = 'text' in ctx.message ? ctx.message.text : '';
        const dateArg = messageText.split(' ').slice(1).join(' ').trim();
        
        try {
            let notes;
            if (!dateArg) {
                notes = await this.getDairyNotes(chatId, new Date());
                await this.sendDairyNotes(ctx, notes, 'сегодня');
            } else {
                const { date: parsedDate } = this.dateParser.extractDateFromFirstLine(dateArg);
                if (!parsedDate) {
                    await ctx.reply('Не удалось распознать дату. Используйте форматы: DD.MM.YYYY, DD.MM, DD месяц');
                    return;
                }

                if (dateArg.includes(String(parsedDate.getFullYear()))) {
                    notes = await this.getDairyNotes(chatId, parsedDate);
                    await this.sendDairyNotes(ctx, notes, format(parsedDate, 'd MMMM yyyy', { locale: ru }));
                } else {
                    notes = await this.getDairyNotesForDayMonth(chatId, parsedDate.getMonth(), parsedDate.getDate());
                    await this.sendDairyNotesAllYears(ctx, notes, format(parsedDate, 'd MMMM', { locale: ru }));
                }
            }
        } catch (error) {
            console.error('Error handling dairy command:', error);
            await ctx.reply('Произошла ошибка при получении заметок');
        }
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

        const message = notes
            .map(note => note.content)
            .join('\n\n---\n\n');

        await ctx.reply(`Заметки за ${dateStr}:\n\n${message}`);
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
            const message = notes
                .map(note => note.content)
                .join('\n\n---\n\n');

            await ctx.reply(`${dateStr} ${year}:\n\n${message}`);
        }
    }
} 
