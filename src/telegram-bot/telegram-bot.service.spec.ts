import { Test, TestingModule } from '@nestjs/testing';
import { TelegramBotService } from './telegram-bot.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DateParserService } from '../services/date-parser.service';
import { DairyCommandsService } from './dairy-commands.service';
import { StorageService } from '../services/storage.service';

describe('TelegramBotService', () => {
  let service: TelegramBotService;

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
              create: jest.fn(),
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
            extractDateFromFirstLine: jest.fn(),
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
            uploadFile: jest.fn().mockImplementation((buffer, mimeType, chatId) => 
              Promise.resolve(`https://example.com/chats/${chatId}/images/mock-uuid`)
            ),
          },
        },
      ],
    }).compile();

    service = module.get<TelegramBotService>(TelegramBotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
