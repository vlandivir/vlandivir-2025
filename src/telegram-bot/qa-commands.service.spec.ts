import { Test, TestingModule } from '@nestjs/testing';
import { QaCommandsService } from './qa-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { Context } from 'telegraf';

describe('QaCommandsService', () => {
  let service: QaCommandsService;
  const mockPrisma = {
    question: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QaCommandsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<QaCommandsService>(QaCommandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reply when no questions', async () => {
    const ctx: any = { chat: { id: 123 }, reply: jest.fn() };
    mockPrisma.question.findMany.mockResolvedValue([]);
    await service.handleQlCommand(ctx as unknown as Context);
    expect(ctx.reply).toHaveBeenCalledWith('No questions found in this chat');
  });

  it('should list questions', async () => {
    const ctx: any = { chat: { id: 123 }, reply: jest.fn() };
    mockPrisma.question.findMany.mockResolvedValue([
      { questionText: 'Q1', createdAt: new Date() },
      { questionText: 'Q2', createdAt: new Date() },
    ]);
    await service.handleQlCommand(ctx as unknown as Context);
    expect(ctx.reply).toHaveBeenCalledWith('Q1\nQ2');
  });
});
