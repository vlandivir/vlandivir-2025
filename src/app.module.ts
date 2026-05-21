import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ServicesModule } from './services/services.module';
import { MiniAppController } from './mini-app/mini-app.controller';
import { SubsController } from './subs.controller';
import { NotesApiController } from './notes-api.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    ServicesModule,
    TelegramBotModule,
  ],
  controllers: [
    AppController,
    MiniAppController,
    SubsController,
    NotesApiController,
  ],
  providers: [AppService],
})
export class AppModule {}
