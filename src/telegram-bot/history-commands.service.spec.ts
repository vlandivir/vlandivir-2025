import { Test, TestingModule } from '@nestjs/testing';
import { HistoryCommandsService } from './history-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../services/storage.service';

describe('HistoryCommandsService', () => {
  let service: HistoryCommandsService;

  const mockPrismaService = {
    note: {
      findMany: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockStorageService = {
    uploadFileWithKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoryCommandsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
      ],
    }).compile();

    service = module.get<HistoryCommandsService>(HistoryCommandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleHistoryCommand', () => {
    it('should return early if no chatId', async () => {
      const mockContext = {
        chat: undefined,
        reply: jest.fn(),
      } as any;

      await service.handleHistoryCommand(mockContext);

      expect(mockContext.reply).not.toHaveBeenCalled();
    });

    it('should handle empty messages', async () => {
      const mockContext = {
        chat: { id: 123 },
        reply: jest.fn(),
      } as any;

      mockPrismaService.note.findMany.mockResolvedValue([]);

      await service.handleHistoryCommand(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        'Нет сообщений длиннее 21 символов в этом чате.',
      );
    });

    it('should filter messages longer than 21 characters and upload to DO Space', async () => {
      const mockContext = {
        chat: { id: 123 },
        reply: jest.fn(),
      } as any;

      const mockMessages = [
        { content: 'Short message', noteDate: new Date(), images: [] },
        {
          content:
            'This is a much longer message that should be included in the history',
          noteDate: new Date(),
          images: [],
        },
        { content: 'Another short one', noteDate: new Date(), images: [] },
      ];

      mockPrismaService.note.findMany.mockResolvedValue(mockMessages);
      mockStorageService.uploadFileWithKey.mockResolvedValue(
        'https://fra1.digitaloceanspaces.com/vlandivir-2025/history/test-uuid.html',
      );

      await service.handleHistoryCommand(mockContext);

      expect(mockStorageService.uploadFileWithKey).toHaveBeenCalledWith(
        expect.any(Buffer),
        'text/html',
        expect.stringMatching(/^history\/[a-f0-9-]+\.html$/),
      );
      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining(
          'История чата доступна по ссылке: https://fra1.digitaloceanspaces.com/vlandivir-2025/history/',
        ),
      );
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      const input = '<script>alert("test")</script>';
      const expected = '&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;';

      const result = (service as any).escapeHtml(input);
      expect(result).toBe(expected);
    });
  });
});
