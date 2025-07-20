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
    metadata: jest.fn().mockResolvedValue({ width: 800, height: 600 }),
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
      id: 123456,
    },
    message: {
      photo: [
        { file_id: 'photo1', width: 800, height: 600 },
        { file_id: 'photo2', width: 400, height: 300 },
        { file_id: 'photo3', width: 400, height: 300 },
      ],
    },
    telegram: {
      getFile: jest.fn().mockResolvedValue({ file_path: 'test/path' }),
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

    global.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('img')),
    }) as any;

    service = module.get<CollageCommandsService>(CollageCommandsService);
    prismaService = module.get<PrismaService>(PrismaService);
    storageService = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should handle collage command with insufficient images', async () => {
    const contextWithOnePhoto = {
      ...mockContext,
      message: {
        photo: [{ file_id: 'photo1', width: 800, height: 600 }],
      },
    } as unknown as Context;

    await service.handleCollageCommand(contextWithOnePhoto);

    expect(mockContext.reply).toHaveBeenCalledWith(
      'Для создания коллажа нужно минимум 2 изображения в одном сообщении.',
    );
  });

  it('should handle collage command with sufficient images', async () => {
    jest
      .spyOn(storageService, 'uploadFile')
      .mockResolvedValue('https://example.com/collage.jpg');

    await service.handleCollageCommand(mockContext);

    expect(mockContext.replyWithPhoto).toHaveBeenCalledWith(
      'https://example.com/collage.jpg',
      { caption: 'Коллаж из изображений' },
    );
  });

  it('should handle errors gracefully', async () => {
    const contextWithError = {
      ...mockContext,
      message: {
        photo: [
          { file_id: 'photo1', width: 800, height: 600 },
          { file_id: 'photo2', width: 400, height: 300 },
        ],
      },
      telegram: {
        getFile: jest.fn().mockRejectedValue(new Error('Network error')),
      },
    } as unknown as Context;

    await service.handleCollageCommand(contextWithError);

    expect(mockContext.reply).toHaveBeenCalledWith(
      'Произошла ошибка при создании коллажа',
    );
  });
});
