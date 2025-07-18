import { Test, TestingModule } from '@nestjs/testing';
import { CollageCommandsService } from './collage-commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';
import { Context } from 'telegraf';

jest.mock('sharp', () => {
  const sharpMock = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('valid-image')),
    composite: jest.fn().mockReturnThis(),
  }));
  (sharpMock as any).create = jest.fn(() => ({
    composite: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('valid-image')),
  }));
  return sharpMock;
});

describe('CollageCommandsService', () => {
  let service: CollageCommandsService;
  let prismaService: PrismaService;
  let storageService: StorageService;

  const mockContext = {
    chat: {
      id: 123456
    },
    reply: jest.fn(),
    replyWithPhoto: jest.fn(),
  } as unknown as Context;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollageCommandsService,
        {
          provide: PrismaService,
          useValue: {
            image: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: StorageService,
          useValue: {
            downloadFile: jest.fn(),
            uploadFile: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CollageCommandsService>(CollageCommandsService);
    prismaService = module.get<PrismaService>(PrismaService);
    storageService = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should handle collage command with insufficient images', async () => {
    jest.spyOn(prismaService.image, 'findMany').mockResolvedValue([
      { 
        id: 1, 
        url: 'test-url-1',
        description: 'test description',
        noteId: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    await service.handleCollageCommand(mockContext);

    expect(mockContext.reply).toHaveBeenCalledWith(
      'Для создания коллажа нужно минимум 2 изображения. Отправьте больше изображений.'
    );
  });

  it('should handle collage command with sufficient images', async () => {
    const mockImages = [
      { 
        id: 1, 
        url: 'test-url-1',
        description: 'test description',
        noteId: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      { 
        id: 2, 
        url: 'test-url-2',
        description: 'test description',
        noteId: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      { 
        id: 3, 
        url: 'test-url-3',
        description: 'test description',
        noteId: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    jest.spyOn(prismaService.image, 'findMany').mockResolvedValue(mockImages);
    jest.spyOn(storageService, 'downloadFile').mockResolvedValue(Buffer.from('test-image'));
    jest.spyOn(storageService, 'uploadFile').mockResolvedValue('https://example.com/collage.jpg');

    await service.handleCollageCommand(mockContext);

    expect(mockContext.replyWithPhoto).toHaveBeenCalledWith(
      'https://example.com/collage.jpg',
      { caption: 'Коллаж из последних изображений' }
    );
  });

  it('should handle errors gracefully', async () => {
    jest.spyOn(prismaService.image, 'findMany').mockRejectedValue(new Error('Database error'));

    await service.handleCollageCommand(mockContext);

    expect(mockContext.reply).toHaveBeenCalledWith(
      'Произошла ошибка при создании коллажа'
    );
  });
}); 