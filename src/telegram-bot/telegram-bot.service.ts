import { Injectable } from '@nestjs/common';
import { Update, Message } from 'telegraf/typings/core/types/typegram';
import { Telegraf, Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { message, channelPost } from 'telegraf/filters';
import { DairyCommandsService } from './dairy-commands.service';
import { StorageService } from '../services/storage.service';
import { LlmService } from '../services/llm.service';
import { SerbianCommandsService } from './serbian-commands.service';
import { HistoryCommandsService } from './history-commands.service';
import { TaskCommandsService } from './task-commands.service';
import { TaskHistoryCommandsService } from './task-history-commands.service';

type TelegramUpdate = 
    | Update.CallbackQueryUpdate 
    | Update.MessageUpdate 
    | { channel_post: Message.TextMessage };

@Injectable()
export class TelegramBotService {
    private bot: Telegraf<Context>;

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
        private dateParser: DateParserService,
        private dairyCommands: DairyCommandsService,
        private storageService: StorageService,
        private llmService: LlmService,
        private serbianCommands: SerbianCommandsService,
        private historyCommands: HistoryCommandsService,
        private taskCommands: TaskCommandsService,
        private taskHistoryCommands: TaskHistoryCommandsService,
    ) {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
            throw new Error('TELEGRAM_BOT_TOKEN is not defined');
        }
        this.bot = new Telegraf<Context>(token);

        // Добавляем middleware для логирования
        this.bot.use((ctx, next) => {
            const updateType = ctx.updateType;
            const chatType = ctx.chat?.type;
            console.log(`Получено обновление типа [${updateType}] из чата типа [${chatType}]`);
            return next();
        });

        this.setupCommands();
    }

    async startBot() {
        // Заменяем launch() на webhook
        const webhookUrl = this.configService.get<string>('VLANDIVIR_2025_WEBHOOK_URL'); // например, https://your-domain.com/telegram-bot
        if (!webhookUrl) {
            throw new Error('VLANDIVIR_2025_WEBHOOK_URL is not defined');
        }

        // Устанавливаем webhook вместо запуска long polling
        await this.bot.telegram.setWebhook(webhookUrl);
        console.log('Telegram bot webhook set to:', webhookUrl);
    }

    async stopBot() {
        await this.bot.stop();
    }

    private setupCommands() {
        // Регистрируем команды для личных чатов и групп
        this.bot.command(['dairy', 'd'], (ctx) => {
            console.log('Получена команда /dairy /d:', ctx.message?.text);
            return this.dairyCommands.handleDairyCommand(ctx);
        });

        // Регистрируем те же команды для каналов
        this.bot.on(channelPost('text'), async (ctx) => {
            console.log('Получено сообщение из канала:', {
                text: ctx.channelPost.text,
                from: ctx.channelPost.from,
                chat: ctx.chat
            });
            
            if (ctx.channelPost.text.startsWith('/d') || ctx.channelPost.text.startsWith('/dairy')) {
                console.log('Обработка команды /dairy /d из канала');
                await this.dairyCommands.handleDairyCommand(ctx);
                return;
            }
            const update = {
                channel_post: ctx.channelPost
            } as TelegramUpdate;
            await this.handleIncomingMessage(ctx.chat.id, update, true);
        });

        // Add the new Serbian translation command
        this.bot.command(['s'], (ctx) => {
            console.log('Получена команда /s:', ctx.message?.text);
            return this.serbianCommands.handleSerbianCommand(ctx);
        });

        // Add the new history command
        this.bot.command(['history'], (ctx) => {
            console.log('Получена команда /history:', ctx.message?.text);
            return this.historyCommands.handleHistoryCommand(ctx);
        });

        // Add the new task command
        this.bot.command(['t', 'task'], (ctx) => {
            console.log('Получена команда /t /task:', ctx.message?.text);
            return this.taskCommands.handleTaskCommand(ctx);
        });

        // Task list command
        this.bot.command(['tl'], (ctx) => {
            console.log('Получена команда /tl:', ctx.message?.text);
            return this.taskCommands.handleListCommand(ctx);
        });

        // Task history HTML command
        this.bot.command(['th'], (ctx) => {
            console.log('Получена команда /th:', ctx.message?.text);
            return this.taskHistoryCommands.handleTaskHistoryCommand(ctx);
        });

        // Help command
        this.bot.command(['help'], (ctx) => {
            console.log('Получена команда /help');
            return ctx.reply(this.getHelpMessage());
        });

        // Обработчик для текстовых сообщений в личных чатах и группах
        this.bot.on(message('text'), async (ctx) => {
            console.log('Получено текстовое сообщение:', ctx.message.text);
            
            if (!ctx.message.text.startsWith('/')) {
                const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
                await this.handleIncomingMessage(ctx.chat.id, ctx.update, isGroup);
            }
        });

        // Обработчик для фото в личных чатах и группах
        this.bot.on(message('photo'), async (ctx) => {
            console.log('Получено фото из чата/группы');
            
            const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
            await this.handleIncomingPhoto(ctx, isGroup);
        });

        // Обработчик фото из каналов
        this.bot.on(channelPost('photo'), async (ctx) => {
            console.log('Получено фото из канала');
            
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

            // Получаем ID отправителя или создателя канала
            let fromUserId = this.extractSenderId(update);
            
            // Если это канал и нет ID отправителя, получаем создателя канала
            if ('channel_post' in update && !fromUserId) {
                try {
                    const chatInfo = await this.bot.telegram.getChat(chatId);
                    if ('creator' in chatInfo) {
                        const admins = await this.bot.telegram.getChatAdministrators(chatId);
                        const creator = admins.find(admin => admin.status === 'creator');
                        if (creator) {
                            fromUserId = creator.user.id;
                            console.log('Найден создатель канала:', fromUserId);
                        }
                    }
                } catch (error) {
                    console.error('Ошибка при получении информации о создателе канала:', error);
                }
            }

            // Сохраняем сообщение в чат/группу/канал
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

                await this.prisma.botResponse.create({
                    data: {
                        content: botResponse,
                        noteId: savedNote.id,
                        chatId: chatId,
                    }
                });
            }

            // Если это канал и есть ID создателя, сохраняем копию в его личный чат
            if ('channel_post' in update && fromUserId && chatId !== fromUserId) {
                console.log('Сохраняем копию создателю канала:', fromUserId);
                await this.prisma.note.create({
                    data: {
                        content: cleanContent,
                        rawMessage: JSON.parse(JSON.stringify(update)),
                        chatId: fromUserId,
                        noteDate: noteDate || new Date(),
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
        if ('channel_post' in update && update.channel_post && 'text' in update.channel_post) {
            return update.channel_post.text || '';
        }
        return '';
    }

    public async handleIncomingPhoto(ctx: Context, silent: boolean = false) {
        try {
            if (!ctx.message) return;
            
            const photos = 'photo' in ctx.message ? ctx.message.photo : null;
            const caption = 'caption' in ctx.message ? ctx.message.caption : '';
            
            if (!photos || photos.length === 0 || !ctx.chat) return;

            const photo = photos[photos.length - 1];
            const file = await ctx.telegram.getFile(photo.file_id);
            const photoBuffer = await this.downloadPhoto(file.file_path!);
            const photoUrl = await this.storageService.uploadFile(
                photoBuffer,
                'image/jpeg',
                ctx.chat.id
            );

            // Get image description from LLM
            const imageDescription = await this.llmService.describeImage(photoBuffer);

            const { date: noteDate, cleanContent } = this.dateParser.extractDateFromFirstLine(caption || '');
            
            // Получаем ID отправителя или создателя канала
            let fromUserId = ctx.message.from?.id;
            
            // Если это канал и нет ID отправителя, получаем создателя канала
            if (ctx.chat.type === 'channel' && !fromUserId) {
                try {
                    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
                    const creator = admins.find(admin => admin.status === 'creator');
                    if (creator) {
                        fromUserId = creator.user.id;
                        console.log('Найден создатель канала:', fromUserId);
                    }
                } catch (error) {
                    console.error('Ошибка при получении информации о создателе канала:', error);
                }
            }

            // Сохраняем фото в чат/группу/канал
            const savedNote = await this.prisma.note.create({
                data: {
                    content: cleanContent || '',
                    rawMessage: JSON.parse(JSON.stringify(ctx.message)),
                    chatId: ctx.chat.id,
                    noteDate: noteDate || new Date(),
                    images: {
                        create: {
                            url: photoUrl,
                            description: imageDescription,
                        },
                    },
                },
                include: {
                    images: true,
                },
            });

            if (!silent) {
                const botResponse = `Фотография сохранена${
                    noteDate ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}` : ''
                }\n\nОписание: ${imageDescription}`;
                await ctx.reply(botResponse);

                await this.prisma.botResponse.create({
                    data: {
                        content: botResponse,
                        noteId: savedNote.id,
                        chatId: ctx.chat.id,
                    }
                });
            }

            // Если это канал и есть ID создателя, сохраняем копию фото в его личный чат
            if (ctx.chat.type === 'channel' && fromUserId && ctx.chat.id !== fromUserId) {
                console.log('Сохраняем копию фото создателю канала:', fromUserId);
                await this.prisma.note.create({
                    data: {
                        content: cleanContent || '',
                        rawMessage: JSON.parse(JSON.stringify(ctx.message)),
                        chatId: fromUserId,
                        noteDate: noteDate || new Date(),
                        images: {
                            create: {
                                url: photoUrl,
                                description: imageDescription,
                            },
                        },
                    },
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

    private extractSenderId(update: TelegramUpdate): number | undefined {
        if ('message' in update && update.message?.from) {
            return update.message.from.id;
        }
        if ('callback_query' in update && update.callback_query?.from) {
            return update.callback_query.from.id;
        }
        if ('channel_post' in update && update.channel_post?.from) {
            return update.channel_post.from.id;
        }
        return undefined;
    }

    private getHelpMessage(): string {
        const commands = [
            { name: '/dairy or /d', description: 'Dairy Notes' },
            { name: '/history', description: 'Chat History' },
            { name: '/s', description: 'Serbian Translation' },
            { name: '/t or /task', description: 'Create Todo item' },
            { name: '/tl', description: 'List Todo items' },
            { name: '/th', description: 'Tasks HTML export' },
            { name: '/help', description: 'Show this help message' },
        ];
        commands.sort((a, b) => a.name.localeCompare(b.name));
        return commands.map(c => `${c.name} - ${c.description}`).join('\n');
    }

    // Добавляем метод для обработки webhook-обновлений
    async handleWebhook(update: Update) {
        return this.bot.handleUpdate(update);
    }
}