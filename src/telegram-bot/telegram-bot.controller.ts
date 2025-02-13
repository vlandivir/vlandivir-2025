import { Controller, Post, Body } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { Update } from 'telegraf/typings/core/types/typegram';

@Controller('telegram-bot')
export class TelegramBotController {
    constructor(private readonly telegramBotService: TelegramBotService) {}

    @Post()
    handleWebhook(@Body() update: Update.CallbackQueryUpdate | Update.MessageUpdate) {
      // Подробное логирование типа обновления
      console.log('Тип обновления:', 'message' in update ? 'message' : 'callback_query');
      
      const chatId = 'message' in update ? update.message.chat.id : update.callback_query.message?.chat.id;
      
      if (!chatId) {
        console.log('Chat ID not found in update');
        return;
      }
      
      // Добавляем логирование текста сообщения, если оно есть
      if ('message' in update && 'text' in update.message) {
        console.log('Текст сообщения:', update.message.text);
      }
      
      console.log('Получен update для чата:', chatId);
      console.log('Update:', JSON.stringify(update, null, 2));
  
      return this.telegramBotService.handleIncomingMessage(chatId, update);
    }  
}
