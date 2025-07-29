import { Test, TestingModule } from '@nestjs/testing';
import { TaskCommandsService } from './task-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { StorageService } from '../services/storage.service';
import { LlmService } from '../services/llm.service';
import { format } from 'date-fns';
import { Context } from 'telegraf';

describe('TaskCommandsService', () => {
  let service: TaskCommandsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskCommandsService,
        DateParserService,
        {
          provide: PrismaService,
          useValue: { todo: { count: jest.fn() } },
        },
        {
          provide: StorageService,
          useValue: { uploadFile: jest.fn() },
        },
        {
          provide: LlmService,
          useValue: { describeImage: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TaskCommandsService>(TaskCommandsService);
  });

  describe('parseDueDate', () => {
    it('should parse full date and time', () => {
      const svc = service as unknown as { parseDueDate(text: string): Date };
      const result = svc.parseDueDate('2025.07.31 09:30');
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(6); // July
      expect(result.getDate()).toBe(31);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(30);
    });

    it('should parse date without time using parser rules', () => {
      const svc = service as unknown as { parseDueDate(text: string): Date };
      const result = svc.parseDueDate('2 января');
      const year = new Date().getFullYear();
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(year);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(2);
    });

    it('should parse "tomorrow" with time', () => {
      const svc = service as unknown as { parseDueDate(text: string): Date };
      const result = svc.parseDueDate('tomorrow 10:15');
      const expected = new Date();
      expected.setDate(expected.getDate() + 1);
      expected.setHours(10, 15, 0, 0);
      expect(result.getFullYear()).toBe(expected.getFullYear());
      expect(result.getMonth()).toBe(expected.getMonth());
      expect(result.getDate()).toBe(expected.getDate());
      expect(result.getHours()).toBe(10);
      expect(result.getMinutes()).toBe(15);
    });

    it('should parse russian day of week', () => {
      const svc = service as unknown as { parseDueDate(text: string): Date };
      const result = svc.parseDueDate('понедельник');
      expect(result).toBeInstanceOf(Date);
      const today = new Date();
      const targetDay = 1; // Monday
      let diff = (targetDay - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      const expected = new Date();
      expected.setDate(expected.getDate() + diff);
      expect(result.getDate()).toBe(expected.getDate());
      expect(result.getMonth()).toBe(expected.getMonth());
    });
  });

  describe('parseTask', () => {
    it('should parse status token', () => {
      const svc = service as unknown as {
        parseTask(text: string): {
          status?: string;
          tags: string[];
          content: string;
          snoozedUntil?: Date;
        };
      };
      const result = svc.parseTask('-done @tag example') as {
        status: string;
        tags: string[];
        content: string;
      };
      expect(result.status).toBe('done');
      expect(result.tags).toEqual(['tag']);
      expect(result.content).toBe('example');
    });

    it('should parse snoozed status with days', () => {
      const today = new Date();
      const svc = service as unknown as {
        parseTask(text: string): {
          status?: string;
          tags: string[];
          content: string;
          snoozedUntil?: Date;
        };
      };
      const result = svc.parseTask('-snoozed4 @tag example task') as {
        status: string;
        tags: string[];
        content: string;
        snoozedUntil: Date;
      };
      expect(result.status).toBe('snoozed');
      expect(result.tags).toEqual(['tag']);
      expect(result.content).toBe('example task');
      expect(result.snoozedUntil).toBeInstanceOf(Date);

      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() + 4);

      // Check if the date is close to expected (within 1 minute to account for test execution time)
      const timeDiff = Math.abs(
        result.snoozedUntil.getTime() - expectedDate.getTime(),
      );
      expect(timeDiff).toBeLessThan(60000); // less than 1 minute
    });

    it('should parse snoozed status with space between -snoozed and number', () => {
      const today = new Date();
      const svc = service as unknown as {
        parseTask(text: string): {
          status?: string;
          content: string;
          snoozedUntil?: Date;
        };
      };
      const result = svc.parseTask('-snoozed 3 some task content') as {
        status: string;
        content: string;
        snoozedUntil: Date;
      };
      expect(result.status).toBe('snoozed');
      expect(result.content).toBe('some task content');
      expect(result.snoozedUntil).toBeInstanceOf(Date);

      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() + 3);

      // Check if the date is close to expected (within 1 minute to account for test execution time)
      const timeDiff = Math.abs(
        result.snoozedUntil.getTime() - expectedDate.getTime(),
      );
      expect(timeDiff).toBeLessThan(60000); // less than 1 minute
    });

    it('should parse due date with single digit hour', () => {
      const svc = service as unknown as {
        parseTask(text: string): {
          content: string;
          dueDate?: Date;
        };
      };
      const result = svc.parseTask(':2025.07.24 8:30') as {
        content: string;
        dueDate?: Date;
      };
      expect(result.content).toBe('');
      expect(result.dueDate).toBeInstanceOf(Date);
      expect(result.dueDate?.getHours()).toBe(8);
      expect(result.dueDate?.getMinutes()).toBe(30);
    });
  });

  describe('parseFilters', () => {
    it('should parse tags contexts and projects', () => {
      const svc = service as unknown as {
        parseFilters(text: string): {
          tags: string[];
          contexts: string[];
          projects: string[];
          remaining: string[];
        };
      };
      const result = svc.parseFilters('@a .b !Proj rest') as {
        tags: string[];
        contexts: string[];
        projects: string[];
        remaining: string[];
      };
      expect(result.tags).toEqual(['a']);
      expect(result.contexts).toEqual(['b']);
      expect(result.projects).toEqual(['Proj rest']);
      expect(result.remaining).toEqual([]);
    });
  });

  describe('generateKey', () => {
    it('pads single digit counts', async () => {
      const today = new Date();
      const datePart = format(today, 'yyyyMMdd');
      const mockPrisma = { todo: { count: jest.fn().mockResolvedValue(0) } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: { uploadFile: jest.fn() } },
          { provide: LlmService, useValue: { describeImage: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const svcWithPriv = svc as unknown as {
        generateKey(id: number): Promise<string>;
      };
      const key = await svcWithPriv.generateKey(123);
      expect(key).toBe(`T-${datePart}-01`);
    });
  });

  describe('processTaskImages', () => {
    it('uses only the highest quality photo', async () => {
      const mockPrisma = { todo: { count: jest.fn() } };
      const mockUpload = jest.fn().mockResolvedValue('https://img');
      const mockDescribe = jest.fn().mockResolvedValue('desc');

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: { uploadFile: mockUpload } },
          { provide: LlmService, useValue: { describeImage: mockDescribe } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('img')),
      });

      const ctx: Context = {
        message: {
          photo: [
            { file_id: 'a', width: 90, height: 90, file_size: 500 },
            { file_id: 'b', width: 800, height: 800, file_size: 1000 },
            { file_id: 'c', width: 400, height: 400, file_size: 700 },
          ],
        },
        chat: { id: 1 },
        telegram: { getFile: jest.fn().mockResolvedValue({ file_path: 'p' }) },
      } as unknown as Context;

      const images = await svc.processTaskImages(ctx);

      expect(images).toEqual([{ url: 'https://img', description: 'desc' }]);
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockDescribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleTaskCommand edit', () => {
    it('should copy existing task and apply updates', async () => {
      const mockPrisma = {
        todo: {
          count: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({
            key: 'T-20250710-3',
            content: 'old',
            priority: 'A',
            dueDate: undefined,
            tags: ['work'],
            contexts: ['home'],
            projects: ['Proj'],
            status: 'new',
          }),
          create: jest.fn(),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: { uploadFile: jest.fn() } },
          { provide: LlmService, useValue: { describeImage: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const mockReply = jest.fn();
      const ctx: Context = {
        message: {
          text: '/t T-20250710-3 -done @x .y !New :2025.07.31 new text',
        },
        chat: { id: 123456 },
        reply: mockReply,
      } as unknown as Context;
      await svc.handleTaskCommand(ctx);
      expect(mockPrisma.todo.create).toHaveBeenCalledWith(
        expect.objectContaining<Record<string, unknown>>({
          data: expect.objectContaining<Record<string, unknown>>({
            key: 'T-20250710-3',
            status: 'done',
            tags: ['work', 'x'],
            contexts: ['home', 'y'],
            projects: ['New'],
            content: 'new text',
          }),
        }),
      );
      expect(mockReply).toHaveBeenCalledWith('Task T-20250710-3 updated');
    });
  });

  describe('handleTaskCommand empty', () => {
    it('should show format message', async () => {
      const mockPrisma = { todo: { count: jest.fn() } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: { uploadFile: jest.fn() } },
          { provide: LlmService, useValue: { describeImage: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const mockReply = jest.fn();
      const ctx: Context = {
        message: { text: '/t' },
        chat: { id: 123456 },
        reply: mockReply,
      } as unknown as Context;
      await svc.handleTaskCommand(ctx);
      expect(mockReply).toHaveBeenCalledWith(
        expect.stringContaining('Format:'),
      );
    });
  });

  describe('handleListCommand', () => {
    it('should sort tasks by due date', async () => {
      const mockPrisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        todo: { count: jest.fn() },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: { uploadFile: jest.fn() } },
          { provide: LlmService, useValue: { describeImage: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const mockReply = jest.fn();
      const ctx: Context = {
        message: { text: '/tl' },
        chat: { id: 123456 },
        reply: mockReply,
      } as unknown as Context;
      await svc.handleListCommand(ctx);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY "dueDate" IS NULL, "dueDate" ASC'),
      );
    });

    it('should add icons for tasks with due dates', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 86400000);
      const today = new Date(now);
      today.setHours(23, 59, 0, 0);
      const future = new Date(now.getTime() + 86400000 * 2);

      const mockPrisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          {
            id: 1,
            key: 'T-1',
            content: 'Past',
            createdAt: past,
            status: 'new',
            completedAt: null,
            priority: null,
            dueDate: past,
            snoozedUntil: null,
            tags: [],
            contexts: [],
            projects: [],
          },
          {
            id: 2,
            key: 'T-2',
            content: 'Today',
            createdAt: now,
            status: 'new',
            completedAt: null,
            priority: null,
            dueDate: today,
            snoozedUntil: null,
            tags: [],
            contexts: [],
            projects: [],
          },
          {
            id: 3,
            key: 'T-3',
            content: 'Future',
            createdAt: now,
            status: 'new',
            completedAt: null,
            priority: null,
            dueDate: future,
            snoozedUntil: null,
            tags: [],
            contexts: [],
            projects: [],
          },
        ]),
        todo: { count: jest.fn() },
        image: { findMany: jest.fn().mockResolvedValue([]) },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: { uploadFile: jest.fn() } },
          { provide: LlmService, useValue: { describeImage: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const mockReply = jest.fn();
      const ctx: Context = {
        message: { text: '/tl' },
        chat: { id: 123456 },
        reply: mockReply,
      } as unknown as Context;

      await svc.handleListCommand(ctx);

      const replyText = mockReply.mock.calls[0][0] as string;
      expect(replyText).toContain('❗');
      expect(replyText).toContain('⏰');
      expect(replyText).toContain('📅');
    });
  });

  describe('startEditConversation', () => {
    it('should enter task edit scene', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TaskCommandsService,
          DateParserService,
          { provide: PrismaService, useValue: {} },
          { provide: StorageService, useValue: { uploadFile: jest.fn() } },
          { provide: LlmService, useValue: { describeImage: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const ctx: Context & { scene: { enter: jest.Mock } } = {
        chat: { id: 1 },
        scene: { enter: jest.fn() },
      } as unknown as Context & { scene: { enter: jest.Mock } };

      await svc.startEditConversation(ctx, 'T-1');

      expect(ctx.scene.enter).toHaveBeenCalledWith('taskEditScene', {
        key: 'T-1',
      });
    });
  });
});
