import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { HistoryCommandsService } from '../telegram-bot/history-commands.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HistoryController],
  providers: [HistoryCommandsService],
  exports: [HistoryCommandsService]
})
export class HistoryModule {} 