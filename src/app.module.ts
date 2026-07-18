import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { MiniAppController } from './mini-app/mini-app.controller';
import { SubsController } from './subs.controller';
import { NotesApiController } from './notes-api.controller';
import { NotificationsApiController } from './notifications-api.controller';
import { MapApiController } from './map-api.controller';
import { MapPagesController } from './map-pages.controller';
import { ReelsApiController } from './reels-api.controller';
import { ReelsPagesController } from './reels-pages.controller';
import { McpController } from './mcp/mcp.controller';
import { McpToolsService } from './mcp/mcp-tools.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    ServicesModule,
    TelegramBotModule,
  ],
  controllers: [
    AppController,
    MiniAppController,
    SubsController,
    NotesApiController,
    NotificationsApiController,
    MapApiController,
    MapPagesController,
    ReelsApiController,
    ReelsPagesController,
    McpController,
  ],
  providers: [AppService, McpToolsService],
})
export class AppModule {}
