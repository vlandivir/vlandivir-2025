import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';

@Module({
  controllers: [TelegramBotController],
  providers: [TelegramBotService, PrismaService, DateParserService],
  imports: [ConfigModule],
  exports: [TelegramBotService]
})
export class TelegramBotModule implements OnModuleInit, OnModuleDestroy {
  constructor(private botService: TelegramBotService) {}

  async onModuleInit() {
    await this.botService.startBot();
  }

  async onModuleDestroy() {
    await this.botService.stopBot();
  }
}
