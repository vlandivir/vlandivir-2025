import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { DateParserService } from '../services/date-parser.service';
import { DairyCommandsService } from './dairy-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';
import { SerbianCommandsService } from './serbian-commands.service';
import { HistoryCommandsService } from './history-commands.service';
import { TaskCommandsService } from './task-commands.service';
import { TaskHistoryCommandsService } from './task-history-commands.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [TelegramBotController],
  providers: [
    TelegramBotService,
    DairyCommandsService,
    PrismaService,
    DateParserService,
    StorageService,
    SerbianCommandsService,
    HistoryCommandsService,
    TaskCommandsService,
    TaskHistoryCommandsService,
  ],
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
