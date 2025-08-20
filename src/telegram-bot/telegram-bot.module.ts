import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ServicesModule } from '../services/services.module';
import { DairyCommandsService } from './dairy-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { SerbianCommandsService } from './serbian-commands.service';
import { ForeignCommandsService } from './foreign-commands.service';
import { HistoryCommandsService } from './history-commands.service';
import { TaskCommandsService } from './task-commands.service';
import { TaskHistoryCommandsService } from './task-history-commands.service';
import { CollageCommandsService } from './collage-commands.service';
import { QaCommandsService } from './qa-commands.service';

@Module({
  imports: [ConfigModule, PrismaModule, ServicesModule],
  controllers: [TelegramBotController],
  providers: [
    TelegramBotService,
    DairyCommandsService,
    PrismaService,
    SerbianCommandsService,
    ForeignCommandsService,
    HistoryCommandsService,
    TaskCommandsService,
    TaskHistoryCommandsService,
    CollageCommandsService,
    QaCommandsService,
  ],
  exports: [TelegramBotService],
})
export class TelegramBotModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly botService: TelegramBotService) {}

  onModuleInit() {
    this.botService.startBot();
  }

  onModuleDestroy() {
    this.botService.stopBot();
  }
}
