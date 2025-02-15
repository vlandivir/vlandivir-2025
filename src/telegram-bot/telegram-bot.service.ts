import { Injectable } from '@nestjs/common';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Telegraf, Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { message, channelPost } from 'telegraf/filters';
import { DairyCommandsService } from './dairy-commands.service';
import { StorageService } from '../services/storage.service';

type TelegramUpdate = Update.CallbackQueryUpdate | Update.MessageUpdate | Update.ChannelPostUpdate;

@Injectable()
export class TelegramBotService {
    private bot: Telegraf<Context>;

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
        private dateParser: DateParserService,
        private dairyCommands: DairyCommandsService,
        private storageService: StorageService,
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
        // Регистрируем команды для личных чатов и каналов
        this.bot.command(['dairy', 'd'], (ctx) => this.dairyCommands.handleDairyCommand(ctx));

        // Обработчик для текстовых сообщений в личных чатах
        this.bot.on(message('text'), async (ctx) => {
            if (!ctx.message.text.startsWith('/')) {
                await this.handleIncomingMessage(ctx.chat.id, ctx.update, false);
            }
        });

        // Обработчик для фото в личных чатах
        this.bot.on(message('photo'), async (ctx) => {
            await this.handleIncomingPhoto(ctx, false);
        });

        // Обработчик текстовых сообщений из каналов
        this.bot.on(channelPost('text'), async (ctx) => {
            const update = {
                message: ctx.channelPost,
                ...ctx.update
            } as TelegramUpdate;
            await this.handleIncomingMessage(ctx.chat.id, update, true);
        });

        // Обработчик фото из каналов
        this.bot.on(channelPost('photo'), async (ctx) => {
            if (!ctx.channelPost) return;
            
            const photoContext = {
                ...ctx,
                message: ctx.channelPost,
                chat: ctx.chat,
                updateType: 'message',
                me: ctx.botInfo,
                tg: ctx.telegram,
                editedMessage: undefined,
                state: {},
            } as unknown as Context<Update>;
            
            await this.handleIncomingPhoto(photoContext, true);
        });
    }

    async handleIncomingMessage(chatId: number, update: TelegramUpdate, silent: boolean = false) {
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

            if (!silent) {
                // Формируем и отправляем ответ бота только для личных чатов
                const botResponse = `Сообщение сохранено${noteDate ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}` : ''}`;
                await this.bot.telegram.sendMessage(chatId, botResponse);

                // Сохраняем ответ бота
                await this.prisma.botResponse.create({
                    data: {
                        content: botResponse,
                        noteId: savedNote.id,
                        chatId: chatId,
                    }
                });
            }
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

    public async handleIncomingPhoto(ctx: Context, silent: boolean = false) {
        try {
            if (!ctx.message) return;
            
            const photos = 'photo' in ctx.message ? ctx.message.photo : null;
            const caption = 'caption' in ctx.message ? ctx.message.caption : '';
            
            if (!photos || photos.length === 0 || !ctx.chat) return;

            // Get the best quality photo
            const photo = photos[photos.length - 1];
            
            // Download photo
            const file = await ctx.telegram.getFile(photo.file_id);
            const photoBuffer = await this.downloadPhoto(file.file_path!);

            // Upload to DO Spaces with chat ID
            const photoUrl = await this.storageService.uploadFile(
                photoBuffer,
                'image/jpeg',
                ctx.chat.id
            );

            // Parse date from caption if exists
            const { date: noteDate, cleanContent } = this.dateParser.extractDateFromFirstLine(caption || '');

            // Save note with photo
            const savedNote = await this.prisma.note.create({
                data: {
                    content: cleanContent || '',
                    rawMessage: JSON.parse(JSON.stringify(ctx.message)),
                    chatId: ctx.chat.id,
                    noteDate: noteDate || new Date(),
                    images: {
                        create: {
                            url: photoUrl,
                        },
                    },
                },
                include: {
                    images: true,
                },
            });

            if (!silent) {
                // Отправляем ответ только для личных чатов
                const botResponse = `Фотография сохранена${
                    noteDate ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}` : ''
                }`;
                await ctx.reply(botResponse);

                // Сохраняем ответ бота
                await this.prisma.botResponse.create({
                    data: {
                        content: botResponse,
                        noteId: savedNote.id,
                        chatId: ctx.chat.id,
                    }
                });
            }
        } catch (error) {
            console.error('Error processing photo:', error);
            if (!silent) {
                await ctx.reply('Произошла ошибка при сохранении фотографии');
            }
        }
    }

    private async downloadPhoto(filePath: string): Promise<Buffer> {
        const response = await fetch(
            `https://api.telegram.org/file/bot${this.configService.get('TELEGRAM_BOT_TOKEN')}/${filePath}`
        );
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
}