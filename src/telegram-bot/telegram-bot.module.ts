import { Module } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  controllers: [TelegramBotController],
  providers: [TelegramBotService],
  imports: [ConfigModule]
})
export class TelegramBotModule {}
