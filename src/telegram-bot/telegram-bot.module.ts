import { Module } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';

@Module({
  controllers: [TelegramBotController]
})
export class TelegramBotModule {}
