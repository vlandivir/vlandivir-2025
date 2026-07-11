import { Test, TestingModule } from '@nestjs/testing';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { DairyCommandsService } from './dairy-commands.service';
import { FindCommandsService } from './find-commands.service';
import { StorageService } from '../services/storage.service';
import { LlmService } from '../services/llm.service';
import { SerbianCommandsService } from './serbian-commands.service';
import { ForeignCommandsService } from './foreign-commands.service';
import { HistoryCommandsService } from './history-commands.service';
import { CollageCommandsService } from './collage-commands.service';
import { Context } from 'telegraf';
import { DebugLogService } from '../services/debug-log.service';

describe('TelegramBotService', () => {
  let service: TelegramBotService;

  const mockReply = jest.fn();
  const baseContext = {
    chat: {
      id: 123456,
      type: 'private',
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
  };

  const mockPhotoContext = {
    ...baseContext,
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
  } as unknown as Context;

  const mockVideoContext = {
    ...baseContext,
    message: {
      video: {
        file_id: 'test-video-id',
        width: 100,
        height: 100,
        duration: 1,
      },
      caption: 'video caption',
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
          provide: FindCommandsService,
          useValue: {
            handleFindCommand: jest.fn(),
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
            uploadVideo: jest
              .fn()
              .mockImplementation((buffer, mimeType, chatId) =>
                Promise.resolve(
                  `https://example.com/chats/${chatId}/videos/mock-uuid`,
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
          provide: ForeignCommandsService,
          useValue: {
            handleForeignCommand: jest.fn(),
          },
        },
        {
          provide: HistoryCommandsService,
          useValue: {
            handleHistoryCommand: jest.fn(),
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
          provide: DebugLogService,
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
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
    await service.handleIncomingPhoto(mockPhotoContext);
    expect(mockReply).toHaveBeenCalled();
  });

  it('should handle channel posts', async () => {
    const channelReply = jest.fn();
    const channelContext = {
      ...mockPhotoContext,
      channelPost: {
        ...mockPhotoContext.message,
        chat: { id: -1001234567890, type: 'channel', title: 'Test Channel' },
      },
      updateType: 'channel_post',
      reply: channelReply,
    } as unknown as Context;

    await service.handleIncomingPhoto(channelContext);
    expect(channelReply).toHaveBeenCalled();
  });

  it('should handle video messages', async () => {
    await service.handleIncomingVideo(mockVideoContext);
    expect(mockReply).toHaveBeenCalled();
  });

  it('should return sorted help message', () => {
    const svc = service as unknown as { getHelpMessage(): string };
    const result = svc.getHelpMessage();
    const expected = [
      '/a - Open App',
      '/bar - Distance to Pivski Zabavnik',
      '/c or /collage - Create image collage',
      '/d or /dairy - Dairy Notes',
      '/dl or /debuglog - Export in-memory debug log',
      '/f or /find - Semantic search over notes',
      '/help - Show this help message',
      '/history - Chat History',
      '/p or /phrase - Translate between RU/EN/SR',
      '/s - Serbian Translation',
    ].join('\n');
    expect(result).toBe(expected);
  });
});
