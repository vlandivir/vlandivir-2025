import { Injectable } from '@nestjs/common';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

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

    async handleIncomingMessage(chatId: number, update: Update.CallbackQueryUpdate | Update.MessageUpdate) {
        try {
            // Сохраняем сообщение в базу
            await this.prisma.note.create({
                data: {
                    content: this.extractMessageText(update),
                    rawMessage: update as any, // Сохраняем весь объект update
                    userId: chatId,
                }
            });

            // Отправляем ответ
            await this.bot.telegram.sendMessage(chatId, 'Привет!');
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }    

    private extractMessageText(update: Update.CallbackQueryUpdate | Update.MessageUpdate): string {
        if ('message' in update && update.message && 'text' in update.message) {
            return update.message.text || '';
        }
        if ('callback_query' in update && update.callback_query.message && 'text' in update.callback_query.message) {
            return update.callback_query.message.text || '';
        }
        return '';
    }
}
