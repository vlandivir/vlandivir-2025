import { Controller, Post, Body } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { Update } from 'telegraf/typings/core/types/typegram';

@Controller('telegram-bot')
export class TelegramBotController {
    constructor(private readonly telegramBotService: TelegramBotService) {}

    @Post()
    handleWebhook(@Body() update: Update.CallbackQueryUpdate | Update.MessageUpdate) {
      const chatId = 'message' in update ? update.message.chat.id : update.callback_query.message?.chat.id;
      
      if (!chatId) {
        console.log('Chat ID not found in update');
        return;
      }
      
      console.log('Получен update для чата:', chatId);
      console.log('Update:', update);
  
      return this.telegramBotService.handleIncomingMessage(chatId, update);
    }  
}
