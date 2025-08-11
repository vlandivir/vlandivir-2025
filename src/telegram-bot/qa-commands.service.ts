import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import {
  CallbackQuery,
  InlineKeyboardMarkup,
} from 'telegraf/typings/core/types/typegram';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { StorageService } from '../services/storage.service';
import {
  startOfDay,
  endOfDay,
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  getDaysInMonth,
} from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

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
    private readonly storageService: StorageService,
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

  async handleQqCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const text = this.getCommandText(ctx)
      .replace(/^\/qq\s*/, '')
      .trim();
    const { date } = this.dateParser.extractDateFromFirstLine(text);
    const targetDate = date || new Date();

    const questions = await this.prisma.question.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      include: {
        Answer: {
          where: {
            answerDate: {
              gte: startOfDay(targetDate),
              lt: endOfDay(targetDate),
            },
          },
        },
      },
    });

    if (questions.length === 0) {
      await ctx.reply('No questions found in this chat');
      return;
    }

    const lines = questions.map((q) => {
      const ans = q.Answer[0];
      if (!ans) return `${q.questionText}: -`;
      return `${q.questionText}: ${ans.textAnswer ?? ans.numberAnswer ?? ''}`;
    });

    await ctx.reply(lines.join('\n'));
  }

  async handleQhCommand(ctx: Context) {
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

    // Build comparison for previous and current months by day-of-month
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const previousMonthStart = startOfMonth(subMonths(currentMonthStart, 1));
    const previousMonthEnd = endOfMonth(previousMonthStart);

    const [prevMonthName, currMonthName] = [
      format(previousMonthStart, 'LLL'),
      format(currentMonthStart, 'LLL'),
    ];

    const answers = await this.prisma.answer.findMany({
      where: {
        questionId: { in: questions.map((q) => q.id) },
        answerDate: { gte: previousMonthStart, lte: currentMonthEnd },
      },
      orderBy: { answerDate: 'asc' },
    });

    type MonthMap = Record<string, Record<number, string | number>>;
    const prevMap: MonthMap = {};
    const currMap: MonthMap = {};

    for (const a of answers) {
      const isPrev =
        a.answerDate >= previousMonthStart && a.answerDate <= previousMonthEnd;
      const isCurr =
        a.answerDate >= currentMonthStart && a.answerDate <= currentMonthEnd;
      const dayKey = String(a.answerDate.getDate()).padStart(2, '0');
      const value = a.textAnswer ?? a.numberAnswer ?? '';
      if (isPrev) {
        if (!prevMap[dayKey]) prevMap[dayKey] = {};
        prevMap[dayKey][a.questionId] = value;
      } else if (isCurr) {
        if (!currMap[dayKey]) currMap[dayKey] = {};
        currMap[dayKey][a.questionId] = value;
      }
    }

    const html = this.generateHtmlMonthComparison(
      questions,
      prevMonthName,
      currMonthName,
      prevMap,
      currMap,
      getDaysInMonth(previousMonthStart),
      getDaysInMonth(currentMonthStart),
    );
    const key = `qa-history/${uuidv4()}.html`;
    const buffer = Buffer.from(html, 'utf8');
    const url = await this.storageService.uploadFileWithKey(
      buffer,
      'text/html',
      key,
    );
    await ctx.reply(`Questions history: ${url}`);
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
    const existing = await this.prisma.answer.findFirst({
      where: {
        questionId: question.id,
        answerDate: {
          gte: startOfDay(session.date),
          lt: endOfDay(session.date),
        },
      },
    });
    if (existing) {
      await this.prisma.answer.update({
        where: { id: existing.id },
        data: { textAnswer },
      });
    } else {
      await this.prisma.answer.create({
        data: { questionId: question.id, textAnswer, answerDate: session.date },
      });
    }
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
      const addMode = text.startsWith('+');
      const num = parseFloat(addMode ? text.slice(1) : text);
      if (Number.isNaN(num)) {
        await ctx.reply('Please provide a number');
        return;
      }
      const existing = await this.prisma.answer.findFirst({
        where: {
          questionId: question.id,
          answerDate: {
            gte: startOfDay(session.date),
            lt: endOfDay(session.date),
          },
        },
      });
      const newValue = addMode ? (existing?.numberAnswer ?? 0) + num : num;
      if (existing) {
        await this.prisma.answer.update({
          where: { id: existing.id },
          data: { numberAnswer: newValue },
        });
      } else {
        await this.prisma.answer.create({
          data: {
            questionId: question.id,
            numberAnswer: newValue,
            answerDate: session.date,
          },
        });
      }
    } else {
      const existing = await this.prisma.answer.findFirst({
        where: {
          questionId: question.id,
          answerDate: {
            gte: startOfDay(session.date),
            lt: endOfDay(session.date),
          },
        },
      });
      if (existing) {
        await this.prisma.answer.update({
          where: { id: existing.id },
          data: { textAnswer: text },
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

    if (question.type === 'number') {
      if (existing) {
        await ctx.reply(
          `Q: ${question.questionText}\nCurrent answer: ${existing.numberAnswer}`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: 'Skip', callback_data: 'q_skip' }]],
            },
          },
        );
      } else {
        await ctx.reply(question.questionText);
      }
      session.awaitingAnswer = true;
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

  private generateHtmlMonthComparison(
    questions: { id: number; questionText: string; type: string }[],
    prevMonthName: string,
    currMonthName: string,
    prevData: Record<string, Record<number, string | number>>,
    currData: Record<string, Record<number, string | number>>,
    prevMonthDays: number,
    currMonthDays: number,
  ): string {
    const dayLabels: string[] = Array.from({ length: 31 }, (_, i) =>
      String(i + 1).padStart(2, '0'),
    );

    let html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Questions history</title>' +
      '<style>table{border-collapse:collapse;}th,td{border:1px solid #ccc;padding:4px;}th{background:#f0f0f0;}thead tr:nth-child(2) th{background:#fafafa;}</style>' +
      '</head><body>';

    // Table with two header rows
    html += '<table><thead>';
    html += '<tr><th>Day</th>';
    for (const q of questions) {
      html += `<th colspan="2">${this.escapeHtml(q.questionText)}</th>`;
    }
    html += '</tr>';
    html += '<tr><th></th>';
    for (let i = 0; i < questions.length; i++) {
      html += `<th>${this.escapeHtml(prevMonthName)}</th><th>${this.escapeHtml(currMonthName)}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (const d of dayLabels) {
      html += `<tr><td>${d}</td>`;
      for (const q of questions) {
        const prevVal = prevData[d]?.[q.id];
        const currVal = currData[d]?.[q.id];
        const showPrev = parseInt(d, 10) <= prevMonthDays ? prevVal : undefined;
        const showCurr = parseInt(d, 10) <= currMonthDays ? currVal : undefined;
        html += `<td>${showPrev !== undefined ? this.escapeHtml(String(showPrev)) : ''}</td>`;
        html += `<td>${showCurr !== undefined ? this.escapeHtml(String(showCurr)) : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';

    // Charts for numeric questions: two datasets (prev/current month)
    const numericQuestions = questions.filter((q) => q.type === 'number');
    if (numericQuestions.length > 0) {
      html += '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>';
      for (const q of numericQuestions) {
        html += `<h3>${this.escapeHtml(q.questionText)}</h3>`;
        html += `<canvas id="chart-${q.id}" height="220"></canvas>`;
      }
    }

    // Simpler script generation with precomputed arrays per question
    if (numericQuestions.length > 0) {
      html += '<script>';
      html += `const DAY_LABELS = ${JSON.stringify(dayLabels)};`;
      for (const q of numericQuestions) {
        const dataPrevArr = dayLabels.map((d) => {
          const val = prevData[d]?.[q.id];
          const dNum = parseInt(d, 10);
          return dNum <= prevMonthDays && typeof val === 'number' ? val : null;
        });
        const dataCurrArr = dayLabels.map((d) => {
          const val = currData[d]?.[q.id];
          const dNum = parseInt(d, 10);
          return dNum <= currMonthDays && typeof val === 'number' ? val : null;
        });
        html += `new Chart(document.getElementById('chart-${q.id}'),{type:'line',data:{labels:DAY_LABELS,datasets:[{label:${JSON.stringify(
          `${q.questionText} (${prevMonthName})`,
        )},data:${JSON.stringify(
          dataPrevArr,
        )},borderColor:'gray',spanGaps:true,pointRadius:2,fill:false,tension:0.1},{label:${JSON.stringify(
          `${q.questionText} (${currMonthName})`,
        )},data:${JSON.stringify(
          dataCurrArr,
        )},borderColor:'blue',spanGaps:true,pointRadius:2,fill:false,tension:0.1}]}});`;
      }
      html += '</script>';
    }

    html += `<p>Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>`;
    html += '</body></html>';
    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
