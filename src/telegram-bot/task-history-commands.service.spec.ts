import { Test, TestingModule } from '@nestjs/testing';
import { TaskHistoryCommandsService } from './task-history-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';

describe('TaskHistoryCommandsService', () => {
  let service: TaskHistoryCommandsService;
  const mockPrismaService = {
    todo: {
      findMany: jest.fn(),
    },
  };
  const mockStorageService = {
    uploadFileWithKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskHistoryCommandsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<TaskHistoryCommandsService>(TaskHistoryCommandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reply when no tasks', async () => {
    const ctx: any = { 
      chat: { id: 123456 },
      reply: jest.fn() 
    };
    mockPrismaService.todo.findMany.mockResolvedValue([]);
    await service.handleTaskHistoryCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('No tasks found in this chat');
  });
});
