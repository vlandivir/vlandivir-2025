import { Module } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { DateParserService } from '../services/date-parser.service';
import { DairyCommandsService } from './dairy-commands.service';

@Module({
  controllers: [TelegramBotController],
  providers: [TelegramBotService, PrismaModule, DateParserService, DairyCommandsService],
  imports: [ConfigModule],
  exports: [TelegramBotService]
})
export class TelegramBotModule {}
