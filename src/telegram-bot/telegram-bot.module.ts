import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { DateParserService } from '../services/date-parser.service';
import { DairyCommandsService } from './dairy-commands.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [TelegramBotController],
  providers: [TelegramBotService, DateParserService, DairyCommandsService],
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
