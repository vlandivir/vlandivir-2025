import { Injectable } from '@nestjs/common';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramBotService {
    private bot: Telegraf;

    constructor(private configService: ConfigService) {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
            throw new Error('TELEGRAM_BOT_TOKEN is not defined');
        }
        this.bot = new Telegraf(token);
    }

    async handleIncomingMessage(chatId: number, update: Update.CallbackQueryUpdate | Update.MessageUpdate) {
        try {
            await this.bot.telegram.sendMessage(chatId, 'Привет!');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }    
}
