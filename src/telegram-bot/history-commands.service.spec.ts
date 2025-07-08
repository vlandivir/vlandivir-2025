import { Test, TestingModule } from '@nestjs/testing';
import { HistoryCommandsService } from './history-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('HistoryCommandsService', () => {
  let service: HistoryCommandsService;
  let prismaService: PrismaService;
  let configService: ConfigService;

  const mockPrismaService = {
    note: {
      findMany: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
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
      ],
    }).compile();

    service = module.get<HistoryCommandsService>(HistoryCommandsService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
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

      expect(mockContext.reply).toHaveBeenCalledWith('Нет сообщений длиннее 42 символов в этом чате.');
    });

    it('should filter messages longer than 42 characters', async () => {
      const mockContext = {
        chat: { id: 123 },
        reply: jest.fn(),
      } as any;

      const mockMessages = [
        { content: 'Short message', noteDate: new Date(), images: [] },
        { content: 'This is a much longer message that should be included in the history', noteDate: new Date(), images: [] },
        { content: 'Another short one', noteDate: new Date(), images: [] },
      ];

      mockPrismaService.note.findMany.mockResolvedValue(mockMessages);
      mockConfigService.get.mockReturnValue('http://localhost:3000');

      await service.handleHistoryCommand(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('История чата доступна по ссылке: http://localhost:3000/history/')
      );
    });
  });

  describe('getHtmlContent', () => {
    it('should return null for non-existent secretId', () => {
      const result = service.getHtmlContent('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return stored HTML content', () => {
      const testHtml = '<html><body>Test</body></html>';
      const secretId = 'test-id';
      
      // Store content using private method (we'll test the public interface)
      (service as any).storeHtmlContent(secretId, testHtml);
      
      const result = service.getHtmlContent(secretId);
      expect(result).toBe(testHtml);
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