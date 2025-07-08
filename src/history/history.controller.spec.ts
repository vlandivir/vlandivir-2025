import { Test, TestingModule } from '@nestjs/testing';
import { HistoryController } from './history.controller';
import { HistoryCommandsService } from '../telegram-bot/history-commands.service';
import { Response } from 'express';

describe('HistoryController', () => {
  let controller: HistoryController;
  let historyCommandsService: HistoryCommandsService;

  const mockHistoryCommandsService = {
    getHtmlContent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HistoryController],
      providers: [
        {
          provide: HistoryCommandsService,
          useValue: mockHistoryCommandsService,
        },
      ],
    }).compile();

    controller = module.get<HistoryController>(HistoryController);
    historyCommandsService = module.get<HistoryCommandsService>(HistoryCommandsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHistoryPage', () => {
    it('should return 404 for non-existent secretId', async () => {
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as any;

      mockHistoryCommandsService.getHtmlContent.mockReturnValue(null);

      await controller.getHistoryPage('non-existent-id', mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith('Страница не найдена или устарела');
    });

    it('should return HTML content for valid secretId', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;

      const testHtml = '<html><body>Test content</body></html>';
      mockHistoryCommandsService.getHtmlContent.mockReturnValue(testHtml);

      await controller.getHistoryPage('valid-id', mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(mockResponse.send).toHaveBeenCalledWith(testHtml);
    });
  });
}); 