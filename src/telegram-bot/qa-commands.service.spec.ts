import { Test, TestingModule } from '@nestjs/testing';
import { QaCommandsService } from './qa-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { Context } from 'telegraf';
import { DateParserService } from '../services/date-parser.service';
import { StorageService } from '../services/storage.service';

describe('QaCommandsService', () => {
  let service: QaCommandsService;
  const mockPrisma = {
    question: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    answer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockStorage = {
    uploadFileWithKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaCommandsService,
        DateParserService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get<QaCommandsService>(QaCommandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reply when no questions', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 123 }, reply: mockReply } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([]);
    await service.handleQlCommand(ctx);
    expect(mockReply).toHaveBeenCalledWith('No questions found in this chat');
  });

  it('should list questions', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 123 }, reply: mockReply } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      { questionText: 'Q1', createdAt: new Date() },
      { questionText: 'Q2', createdAt: new Date() },
    ]);
    await service.handleQlCommand(ctx);
    expect(mockReply).toHaveBeenCalledWith('Q1\nQ2');
  });
  it('should start question session', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 1 }, reply: mockReply } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 1, questionText: 'Q1', type: 'text', createdAt: new Date() },
    ]);
    await service.handleQCommand(ctx);
    expect(mockReply).toHaveBeenCalledWith('Q1');
    const sessions = (
      service as unknown as {
        askSessions: Map<number, { awaitingAnswer: boolean }>;
      }
    ).askSessions;
    expect(sessions.get(1)).toBeDefined();
  });

  it('should add to existing numeric answer with plus', async () => {
    const mockReply = jest.fn();
    const ctxStart = {
      chat: { id: 2 },
      reply: mockReply,
    } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      {
        id: 2,
        questionText: 'How many?',
        type: 'number',
        createdAt: new Date(),
      },
    ]);
    mockPrisma.answer.findFirst.mockResolvedValueOnce({
      id: 10,
      numberAnswer: 5,
    });
    await service.handleQCommand(ctxStart);

    const sessions = (
      service as unknown as {
        askSessions: Map<number, { awaitingAnswer: boolean }>;
      }
    ).askSessions;
    expect(sessions.get(2)?.awaitingAnswer).toBe(true);

    const ctxAnswer = {
      chat: { id: 2 },
      message: { text: '+3' },
      reply: mockReply,
    } as unknown as Context;
    mockPrisma.answer.findFirst.mockResolvedValueOnce({
      id: 10,
      numberAnswer: 5,
    });
    await service.handleAnswerText(ctxAnswer);
    expect(mockPrisma.answer.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { numberAnswer: 8 },
    });
  });

  it('should update existing binary answer', async () => {
    const mockReply = jest.fn();
    const ctxStart = {
      chat: { id: 3 },
      reply: mockReply,
    } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      {
        id: 3,
        questionText: 'Done?',
        type: 'binary',
        createdAt: new Date(),
      },
    ]);
    // existing answer when listing questions
    mockPrisma.answer.findFirst.mockResolvedValueOnce({
      id: 20,
      textAnswer: 'no',
    });
    await service.handleQCommand(ctxStart);

    const sessions = (
      service as unknown as {
        askSessions: Map<number, { awaitingAnswer: boolean; index: number }>;
      }
    ).askSessions;
    expect(sessions.get(3)?.awaitingAnswer).toBe(false);

    const ctxAnswer = {
      chat: { id: 3 },
      from: { id: 3 },
      callbackQuery: { data: 'q_yes' },
      answerCbQuery: jest.fn(),
      editMessageReplyMarkup: jest.fn(),
      reply: mockReply,
    } as unknown as Context;
    // existing answer when answering
    mockPrisma.answer.findFirst.mockResolvedValueOnce({
      id: 20,
      textAnswer: 'no',
    });
    await service.handleAnswerCallback(ctxAnswer);
    expect(mockPrisma.answer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { textAnswer: 'yes' },
    });
  });

  it('should list questions with answers for a date', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 4 }, reply: mockReply } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      {
        id: 30,
        questionText: 'How are you?',
        type: 'text',
        createdAt: new Date(),
        Answer: [
          { textAnswer: 'fine', numberAnswer: null, answerDate: new Date() },
        ],
      },
    ]);
    await service.handleQqCommand(ctx);
    expect(mockReply).toHaveBeenCalledWith('How are you?: fine');
  });

  it('should generate history html', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 5 }, reply: mockReply } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 1, questionText: 'Q1', type: 'text', createdAt: new Date() },
    ]);
    mockPrisma.answer.findMany.mockResolvedValue([
      {
        questionId: 1,
        textAnswer: 'ok',
        numberAnswer: null,
        answerDate: new Date(),
      },
    ]);
    mockStorage.uploadFileWithKey.mockResolvedValue(
      'https://example.com/qh.html',
    );
    await service.handleQhCommand(ctx);
    expect(mockStorage.uploadFileWithKey).toHaveBeenCalledWith(
      expect.any(Buffer),
      'text/html',
      expect.stringMatching(/^qa-history\/[a-f0-9-]+\.html$/),
    );
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/qh.html'),
    );
  });

  it('should include chart for numeric questions', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 6 }, reply: mockReply } as unknown as Context;
    const day1 = new Date();
    day1.setDate(day1.getDate() - 2);
    const day2 = new Date();
    day2.setDate(day2.getDate() - 1);
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 2, questionText: 'Num', type: 'number', createdAt: new Date() },
    ]);
    mockPrisma.answer.findMany.mockResolvedValue([
      { questionId: 2, textAnswer: null, numberAnswer: 1, answerDate: day1 },
      { questionId: 2, textAnswer: null, numberAnswer: 2, answerDate: day2 },
    ]);
    mockStorage.uploadFileWithKey.mockResolvedValue(
      'https://example.com/qh.html',
    );
    await service.handleQhCommand(ctx);
    const lastCall =
      mockStorage.uploadFileWithKey.mock.calls[
        mockStorage.uploadFileWithKey.mock.calls.length - 1
      ];
    const buffer = lastCall[0] as Buffer;
    const html = buffer.toString();
    const d1 = day1.toISOString().slice(0, 10);
    const d2 = day2.toISOString().slice(0, 10);
    expect(html).toContain(d1);
    expect(html).toContain(d2);
    expect(html).toContain('chart.js');
    expect(html).toContain('<canvas id="chart-2"');
  });
});
