import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import {
  CallbackQuery,
  InlineKeyboardMarkup,
} from 'telegraf/typings/core/types/typegram';
import { PrismaService } from '../prisma/prisma.service';

interface QaSession {
  step: 'await_question' | 'await_type';
  questionText?: string;
}

@Injectable()
export class QaCommandsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly sessions: Map<number, QaSession> = new Map();

  isActive(chatId: number): boolean {
    return this.sessions.has(chatId);
  }

  async handleQaCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const messageText = this.getCommandText(ctx);
    const questionText = messageText.replace(/^\/qa\s*/, '').trim();

    if (questionText) {
      this.sessions.set(chatId, { step: 'await_type', questionText });
      await ctx.reply('Choose question type', {
        reply_markup: { inline_keyboard: this.getTypeKeyboard() },
      });
    } else {
      this.sessions.set(chatId, { step: 'await_question' });
      await ctx.reply('Please send the question text');
    }
  }

  async handleText(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const session = this.sessions.get(chatId);
    if (!session) return;

    if (session.step === 'await_question' && ctx.message && 'text' in ctx.message) {
      session.questionText = ctx.message.text;
      session.step = 'await_type';
      this.sessions.set(chatId, session);
      await ctx.reply('Choose question type', {
        reply_markup: { inline_keyboard: this.getTypeKeyboard() },
      });
    }
  }

  async handleTypeSelection(ctx: Context) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return;
    const session = this.sessions.get(chatId);
    if (!session || session.step !== 'await_type' || !session.questionText) return;

    const data = (ctx.callbackQuery as CallbackQuery.DataQuery | undefined)?.data;
    const typeMap: Record<string, string> = {
      qa_type_string: 'text',
      qa_type_number: 'number',
      qa_type_boolean: 'binary',
    };
    const type = data ? typeMap[data] : undefined;
    if (!type) return;

    await ctx.answerCbQuery();
    await (
      ctx as Context & {
        editMessageReplyMarkup: (
          markup: InlineKeyboardMarkup | undefined,
        ) => Promise<void>;
      }
    ).editMessageReplyMarkup(undefined);

    try {
      await this.prisma.question.create({
        data: {
          chatId,
          questionText: session.questionText,
          type,
        },
      });
      await ctx.reply('Question added');
    } catch (error) {
      console.error('Error saving question:', error);
      await ctx.reply('Error saving question');
    } finally {
      this.sessions.delete(chatId);
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

  private getCommandText(ctx: Context): string {
    if ('message' in ctx && ctx.message && 'text' in ctx.message) {
      return ctx.message.text;
    }
    if ('channelPost' in ctx && ctx.channelPost && 'text' in ctx.channelPost) {
      return ctx.channelPost.text;
    }
    return '';
  }

  private getTypeKeyboard() {
    return [
      [
        { text: 'String', callback_data: 'qa_type_string' },
        { text: 'Number', callback_data: 'qa_type_number' },
        { text: 'Boolean', callback_data: 'qa_type_boolean' },
      ],
    ];
  }
}
