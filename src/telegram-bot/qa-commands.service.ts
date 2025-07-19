import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QaCommandsService {
  constructor(private prisma: PrismaService) {}

  async handleQaCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const messageText = this.getCommandText(ctx);
    if (!messageText) return;

    const questionText = messageText.replace(/^\/qa\s*/, '').trim();
    if (!questionText) {
      await ctx.reply('Please provide question text after the command');
      return;
    }

    try {
      await this.prisma.question.create({
        data: {
          chatId,
          questionText,
          type: 'text',
        },
      });
      await ctx.reply('Question added');
    } catch (error) {
      console.error('Error saving question:', error);
      await ctx.reply('Error saving question');
    }
  }

  private getCommandText(ctx: Context): string | undefined {
    if ('message' in ctx && ctx.message && 'text' in ctx.message) {
      return ctx.message.text;
    }
    if ('channelPost' in ctx && ctx.channelPost && 'text' in ctx.channelPost) {
      return ctx.channelPost.text;
    }
    return undefined;
  }
}
