import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QaCommandsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async handleQlCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const questions = await this.prisma.question.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });

    if (questions.length === 0) {
      await ctx.reply('No questions found in this chat');
      return;
    }

    const lines = questions.map((q) => q.questionText);
    await ctx.reply(lines.join('\n'));
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
