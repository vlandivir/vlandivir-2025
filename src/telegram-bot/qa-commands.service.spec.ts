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
      findMany: jest.fn(),
      create: jest.fn(),
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
      service as unknown as { askSessions: Map<number, unknown> }
    ).askSessions;
    expect(sessions.get(1)).toBeDefined();
  });

  it('should list questions with answers', async () => {
    const mockReply = jest.fn();
    const ctx = { chat: { id: 1 }, reply: mockReply } as unknown as Context;
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 1, questionText: 'Q1', type: 'text', createdAt: new Date() },
      { id: 2, questionText: 'Q2', type: 'number', createdAt: new Date() },
    ]);
    mockPrisma.answer.findMany = jest
      .fn()
      .mockResolvedValue([
        { questionId: 1, textAnswer: 'A1', numberAnswer: null },
      ]);
    await service.handleQqCommand(ctx);
    expect(mockReply).toHaveBeenCalledWith('Q1: A1\nQ2: -');
  });
});
