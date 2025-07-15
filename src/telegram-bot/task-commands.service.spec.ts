import { Test, TestingModule } from '@nestjs/testing';
import { TaskCommandsService } from './task-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';

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
      ],
    }).compile();

    service = module.get<TaskCommandsService>(TaskCommandsService);
  });

  describe('parseDueDate', () => {
    it('should parse full date and time', () => {
      const result = (service as any).parseDueDate('2025.07.31 09:30');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getMonth()).toBe(6); // July
      expect(result?.getDate()).toBe(31);
      expect(result?.getHours()).toBe(9);
      expect(result?.getMinutes()).toBe(30);
    });

    it('should parse date without time using parser rules', () => {
      const result = (service as any).parseDueDate('2 января');
      const year = new Date().getFullYear();
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(year);
      expect(result?.getMonth()).toBe(0);
      expect(result?.getDate()).toBe(2);
    });
  });

  describe('parseTask', () => {
    it('should parse status token', () => {
      const result = (service as any).parseTask('-done @tag example');
      expect(result.status).toBe('done');
      expect(result.tags).toEqual(['tag']);
      expect(result.content).toBe('example');
    });

    it('should parse snoozed status with days', () => {
      const today = new Date();
      const result = (service as any).parseTask('-snoozed4 @tag example task');
      expect(result.status).toBe('snoozed');
      expect(result.tags).toEqual(['tag']);
      expect(result.content).toBe('example task');
      expect(result.snoozedUntil).toBeInstanceOf(Date);
      
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() + 4);
      
      // Check if the date is close to expected (within 1 minute to account for test execution time)
      const timeDiff = Math.abs(result.snoozedUntil.getTime() - expectedDate.getTime());
      expect(timeDiff).toBeLessThan(60000); // less than 1 minute
    });

    it('should parse snoozed status with space between -snoozed and number', () => {
      const today = new Date();
      const result = (service as any).parseTask('-snoozed 3 some task content');
      expect(result.status).toBe('snoozed');
      expect(result.content).toBe('some task content');
      expect(result.snoozedUntil).toBeInstanceOf(Date);
      
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() + 3);
      
      // Check if the date is close to expected (within 1 minute to account for test execution time)
      const timeDiff = Math.abs(result.snoozedUntil.getTime() - expectedDate.getTime());
      expect(timeDiff).toBeLessThan(60000); // less than 1 minute
    });
  });

  describe('parseFilters', () => {
    it('should parse tags contexts and projects', () => {
      const result = (service as any).parseFilters('@a .b !Proj rest');
      expect(result.tags).toEqual(['a']);
      expect(result.contexts).toEqual(['b']);
      expect(result.projects).toEqual(['Proj rest']);
      expect(result.remaining).toEqual([]);
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
        providers: [TaskCommandsService, DateParserService, { provide: PrismaService, useValue: mockPrisma }],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const ctx: any = { 
        message: { text: '/t T-20250710-3 -done @x .y !New :2025.07.31 new text' }, 
        chat: { id: 123456 },
        reply: jest.fn() 
      };
      await svc.handleTaskCommand(ctx);
      expect(mockPrisma.todo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            key: 'T-20250710-3',
            status: 'done',
            tags: ['work', 'x'],
            contexts: ['home', 'y'],
            projects: ['New'],
            content: 'new text',
          }),
        }),
      );
      expect(ctx.reply).toHaveBeenCalledWith('Task T-20250710-3 updated');
    });
  });

  describe('handleTaskCommand empty', () => {
    it('should show format message', async () => {
      const mockPrisma = { todo: { count: jest.fn() } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [TaskCommandsService, DateParserService, { provide: PrismaService, useValue: mockPrisma }],
      }).compile();

      const svc = module.get<TaskCommandsService>(TaskCommandsService);
      const ctx: any = { 
        message: { text: '/t' }, 
        chat: { id: 123456 },
        reply: jest.fn() 
      };
      await svc.handleTaskCommand(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Format:'));
    });
  });
});
