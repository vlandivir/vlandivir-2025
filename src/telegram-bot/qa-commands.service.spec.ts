import { Test, TestingModule } from '@nestjs/testing';
import { QaCommandsService } from './qa-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { Context } from 'telegraf';
import { DateParserService } from '../services/date-parser.service';

describe('QaCommandsService', () => {
  let service: QaCommandsService;
  const mockPrisma = {
    question: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    answer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaCommandsService,
        DateParserService,
        { provide: PrismaService, useValue: mockPrisma },
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
});
