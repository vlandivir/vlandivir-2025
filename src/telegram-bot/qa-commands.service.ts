import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import {
  CallbackQuery,
  InlineKeyboardMarkup,
} from 'telegraf/typings/core/types/typegram';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { startOfDay, endOfDay } from 'date-fns';

interface QaSession {
  step: 'await_question' | 'await_type';
  questionText?: string;
}

interface QRunSession {
  questions: { id: number; questionText: string; type: string }[];
  index: number;
  date: Date;
  awaitingAnswer: boolean;
}

@Injectable()
export class QaCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dateParser: DateParserService,
  ) {}

  private readonly sessions: Map<number, QaSession> = new Map();
  private readonly askSessions: Map<number, QRunSession> = new Map();

  isActive(chatId: number): boolean {
    return this.sessions.has(chatId) || this.askSessions.has(chatId);
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

    const addSession = this.sessions.get(chatId);
    if (addSession) {
      if (
        addSession.step === 'await_question' &&
        ctx.message &&
        'text' in ctx.message
      ) {
        addSession.questionText = ctx.message.text;
        addSession.step = 'await_type';
        this.sessions.set(chatId, addSession);
        await ctx.reply('Choose question type', {
          reply_markup: { inline_keyboard: this.getTypeKeyboard() },
        });
        return;
      }
    }

    if (this.askSessions.has(chatId)) {
      await this.handleAnswerText(ctx);
    }
  }

  async handleTypeSelection(ctx: Context) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return;
    const session = this.sessions.get(chatId);
    if (!session || session.step !== 'await_type' || !session.questionText)
      return;

    const data = (ctx.callbackQuery as CallbackQuery.DataQuery | undefined)
      ?.data;
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

  async handleQCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const text = this.getCommandText(ctx)
      .replace(/^\/q\s*/, '')
      .trim();
    const { date } = this.dateParser.extractDateFromFirstLine(text);
    const answerDate = date || new Date();

    const questions = await this.prisma.question.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });

    if (questions.length === 0) {
      await ctx.reply('No questions found in this chat');
      return;
    }

    this.askSessions.set(chatId, {
      questions,
      index: 0,
      date: answerDate,
      awaitingAnswer: false,
    });

    await this.askNextQuestion(ctx, chatId);
  }

  async handleAnswerCallback(ctx: Context) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return;
    const session = this.askSessions.get(chatId);
    if (!session) return;
    const data = (ctx.callbackQuery as CallbackQuery.DataQuery | undefined)
      ?.data;
    if (!session.questions[session.index]) return;
    const question = session.questions[session.index];

    await ctx.answerCbQuery();
    await (
      ctx as Context & {
        editMessageReplyMarkup: (
          markup: InlineKeyboardMarkup | undefined,
        ) => Promise<void>;
      }
    ).editMessageReplyMarkup(undefined);

    if (data === 'q_skip') {
      session.index++;
      session.awaitingAnswer = false;
      this.askSessions.set(chatId, session);
      await this.askNextQuestion(ctx, chatId);
      return;
    }

    const textAnswer = data === 'q_yes' ? 'yes' : 'no';
    await this.prisma.answer.create({
      data: { questionId: question.id, textAnswer, answerDate: session.date },
    });
    session.index++;
    session.awaitingAnswer = false;
    this.askSessions.set(chatId, session);
    await this.askNextQuestion(ctx, chatId);
  }

  async handleAnswerText(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const session = this.askSessions.get(chatId);
    if (!session || !session.awaitingAnswer) return;
    if (!session.questions[session.index]) return;
    const question = session.questions[session.index];

    if (!ctx.message || !('text' in ctx.message)) return;
    const text = ctx.message.text.trim();

    if (question.type === 'number') {
      const num = parseFloat(text);
      if (Number.isNaN(num)) {
        await ctx.reply('Please provide a number');
        return;
      }
      await this.prisma.answer.create({
        data: {
          questionId: question.id,
          numberAnswer: num,
          answerDate: session.date,
        },
      });
    } else {
      await this.prisma.answer.create({
        data: {
          questionId: question.id,
          textAnswer: text,
          answerDate: session.date,
        },
      });
    }

    session.index++;
    session.awaitingAnswer = false;
    this.askSessions.set(chatId, session);
    await this.askNextQuestion(ctx, chatId);
  }

  private async askNextQuestion(ctx: Context, chatId: number) {
    const session = this.askSessions.get(chatId);
    if (!session) return;

    if (session.index >= session.questions.length) {
      await ctx.reply('All questions processed');
      this.askSessions.delete(chatId);
      return;
    }

    const question = session.questions[session.index];
    const existing = await this.prisma.answer.findFirst({
      where: {
        questionId: question.id,
        answerDate: {
          gte: startOfDay(session.date),
          lt: endOfDay(session.date),
        },
      },
    });

    if (question.type === 'binary') {
      const buttons = [
        [
          { text: 'Yes', callback_data: 'q_yes' },
          { text: 'No', callback_data: 'q_no' },
        ],
      ];
      if (existing) {
        buttons.push([{ text: 'Skip', callback_data: 'q_skip' }]);
        await ctx.reply(
          `Q: ${question.questionText}\nCurrent answer: ${existing.textAnswer ?? existing.numberAnswer}`,
          {
            reply_markup: { inline_keyboard: buttons },
          },
        );
      } else {
        await ctx.reply(question.questionText, {
          reply_markup: { inline_keyboard: buttons },
        });
      }
      session.awaitingAnswer = false;
      this.askSessions.set(chatId, session);
      return;
    }

    if (existing) {
      await ctx.reply(
        `Q: ${question.questionText}\nCurrent answer: ${existing.textAnswer ?? existing.numberAnswer}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: 'Skip', callback_data: 'q_skip' }]],
          },
        },
      );
      session.awaitingAnswer = false;
      this.askSessions.set(chatId, session);
      return;
    }

    session.awaitingAnswer = true;
    this.askSessions.set(chatId, session);
    await ctx.reply(question.questionText);
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
