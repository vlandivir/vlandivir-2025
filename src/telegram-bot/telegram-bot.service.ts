import { Injectable } from '@nestjs/common';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Telegraf, Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';

type TelegramUpdate = Update.CallbackQueryUpdate | Update.MessageUpdate;

@Injectable()
export class TelegramBotService {
    private bot: Telegraf<Context>;

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
        private dateParser: DateParserService
    ) {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
            throw new Error('TELEGRAM_BOT_TOKEN is not defined');
        }
        this.bot = new Telegraf<Context>(token);
        this.setupCommands();
    }

    async startBot() {
        await this.bot.launch();
        console.log('Telegram bot started');
    }

    async stopBot() {
        await this.bot.stop();
    }

    private setupCommands() {
        // Регистрируем обе команды с одинаковым обработчиком
        this.bot.command(['dairy', 'd'], this.handleDairyCommand.bind(this));
    }

    private async handleDairyCommand(ctx: Context) {
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
        const startYear = 2000;
        
        // Получаем записи за указанный день и месяц за все годы
        const notes = await this.prisma.note.findMany({
            where: {
                chatId,
                AND: [
                    {
                        noteDate: {
                            gte: startOfDay(new Date(startYear, month, day))
                        }
                    },
                    {
                        noteDate: {
                            lt: endOfDay(new Date(currentYear, month, day))
                        }
                    }
                ]
            },
            orderBy: {
                noteDate: 'desc'
            }
        });

        // Группируем заметки по годам
        return notes.reduce((acc, note) => {
            const year = note.noteDate.getFullYear();
            if (!acc[year]) {
                acc[year] = [];
            }
            acc[year].push(note);
            return acc;
        }, {} as Record<number, typeof notes>);
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

    async handleIncomingMessage(chatId: number, update: TelegramUpdate) {
        try {
            const messageText = this.extractMessageText(update);
            const { date: noteDate, cleanContent } = this.dateParser.extractDateFromFirstLine(messageText);

            // Сохраняем сообщение пользователя в базу
            const savedNote = await this.prisma.note.create({
                data: {
                    content: cleanContent,
                    rawMessage: JSON.parse(JSON.stringify(update)),
                    chatId: chatId,
                    noteDate: noteDate || new Date(),
                }
            });

            // Формируем ответ бота
            const botResponse = 'Привет!';
            
            // Отправляем ответ
            await this.bot.telegram.sendMessage(chatId, botResponse);

            // Сохраняем ответ бота
            await this.prisma.botResponse.create({
                data: {
                    content: botResponse,
                    noteId: savedNote.id,
                    chatId: chatId,
                }
            });
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }    

    private extractMessageText(update: TelegramUpdate): string {
        if ('message' in update && update.message && 'text' in update.message) {
            return update.message.text || '';
        }
        if ('callback_query' in update && update.callback_query.message && 'text' in update.callback_query.message) {
            return update.callback_query.message.text || '';
        }
        return '';
    }
}
