import { Injectable } from '@nestjs/common';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type TelegramUpdate = Update.CallbackQueryUpdate | Update.MessageUpdate;

@Injectable()
export class TelegramBotService {
    private bot: Telegraf;

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService
    ) {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
            throw new Error('TELEGRAM_BOT_TOKEN is not defined');
        }
        this.bot = new Telegraf(token);
    }

    async handleIncomingMessage(chatId: number, update: TelegramUpdate) {
        try {
            // Сохраняем сообщение пользователя в базу
            const savedNote = await this.prisma.note.create({
                data: {
                    content: this.extractMessageText(update),
                    rawMessage: JSON.parse(JSON.stringify(update)),
                    chatId: chatId,
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
