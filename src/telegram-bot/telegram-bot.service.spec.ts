import { Test, TestingModule } from '@nestjs/testing';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { DairyCommandsService } from './dairy-commands.service';
import { StorageService } from '../services/storage.service';
import { LlmService } from '../services/llm.service';
import { SerbianCommandsService } from './serbian-commands.service';
import { HistoryCommandsService } from './history-commands.service';
import { TaskCommandsService } from './task-commands.service';
import { TaskHistoryCommandsService } from './task-history-commands.service';
import { CollageCommandsService } from './collage-commands.service';
import { QaCommandsService } from './qa-commands.service';
import { Context } from 'telegraf';

describe('TelegramBotService', () => {
  let service: TelegramBotService;

  const mockReply = jest.fn();
  const mockContext = {
    message: {
      text: 'test message',
      photo: [
        {
          file_id: 'test-file-id',
          width: 100,
          height: 100,
        },
      ],
      caption: 'test caption',
    },
    chat: {
      id: 123456,
    },
    telegram: {
      getFile: jest.fn().mockResolvedValue({ file_path: 'test/path' }),
    },
    reply: mockReply,
    updateType: 'message',
    me: {
      id: 123,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
    },
    tg: {
      getFile: jest.fn().mockResolvedValue({ file_path: 'test/path' }),
    },
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
    },
  } as unknown as Context;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramBotService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('mock_token'),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            note: {
              create: jest.fn().mockResolvedValue({
                id: 1,
                content: 'test content',
              }),
              findMany: jest.fn(),
            },
            botResponse: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: DateParserService,
          useValue: {
            extractDateFromFirstLine: jest.fn().mockReturnValue({
              date: new Date(),
              cleanContent: 'test content',
            }),
          },
        },
        {
          provide: DairyCommandsService,
          useValue: {
            handleDairyCommand: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            uploadFile: jest
              .fn()
              .mockImplementation((buffer, mimeType, chatId) =>
                Promise.resolve(
                  `https://example.com/chats/${chatId}/images/mock-uuid`,
                ),
              ),
          },
        },
        {
          provide: LlmService,
          useValue: {
            describeImage: jest.fn().mockResolvedValue('test description'),
          },
        },
        {
          provide: SerbianCommandsService,
          useValue: {
            handleSerbianCommand: jest.fn(),
          },
        },
        {
          provide: HistoryCommandsService,
          useValue: {
            handleHistoryCommand: jest.fn(),
          },
        },
        {
          provide: TaskCommandsService,
          useValue: {
            handleTaskCommand: jest.fn(),
            handleListCommand: jest.fn(),
          },
        },
        {
          provide: TaskHistoryCommandsService,
          useValue: {
            handleTaskHistoryCommand: jest.fn(),
          },
        },
        {
          provide: CollageCommandsService,
          useValue: {
            handleCollageCommand: jest.fn(),
            startConversation: jest.fn(),
            addImage: jest.fn(),
            cancel: jest.fn(),
            generate: jest.fn(),
            isActive: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: QaCommandsService,
          useValue: {
            handleQaCommand: jest.fn(),
            handleQlCommand: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TelegramBotService>(TelegramBotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should handle photo messages', async () => {
    await service.handleIncomingPhoto(mockContext);
    expect(mockReply).toHaveBeenCalled();
  });

  it('should handle channel posts', async () => {
    const channelReply = jest.fn();
    const channelContext = {
      ...mockContext,
      channelPost: {
        ...mockContext.message,
        chat: { id: -1001234567890, type: 'channel', title: 'Test Channel' },
      },
      updateType: 'channel_post',
      reply: channelReply,
    } as unknown as Context;

    await service.handleIncomingPhoto(channelContext);
    expect(channelReply).toHaveBeenCalled();
  });

  it('should return sorted help message', () => {
    const svc = service as unknown as { getHelpMessage(): string };
    const result = svc.getHelpMessage();
    const expected = [
      '/c or /collage - Create image collage',
      '/d or /dairy - Dairy Notes',
      '/help - Show this help message',
      '/history - Chat History',
      '/qa - Add question',
      '/ql - List questions',
      '/s - Serbian Translation',
      '/t or /task - Create Todo item',
      '/th - Tasks HTML export',
      '/tl - List Todo items',
    ].join('\n');
    expect(result).toBe(expected);
  });
});
