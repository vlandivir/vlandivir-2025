import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { NotesApiController } from './notes-api.controller';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './services/storage.service';

describe('NotesApiController', () => {
  let controller: NotesApiController;
  let prisma: {
    note: {
      create: jest.Mock;
    };
  };
  let storageService: {
    uploadFile: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'notes-api-test-'));

    prisma = {
      note: {
        create: jest.fn().mockResolvedValue({
          id: 10,
          content: 'hello note',
          noteDate: new Date('2026-05-21T10:00:00.000Z'),
          images: [{ url: 'https://example.com/image.jpg' }],
        }),
      },
    };
    storageService = {
      uploadFile: jest.fn().mockResolvedValue('https://example.com/image.jpg'),
    };
    configService = {
      get: jest.fn().mockReturnValue('secret'),
    };

    controller = new NotesApiController(
      prisma as unknown as PrismaService,
      storageService as unknown as StorageService,
      configService as unknown as ConfigService,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a note for the primary chat with an uploaded image', async () => {
    const imagePath = join(tmpDir, 'image.jpg');
    await writeFile(imagePath, Buffer.from('image'));

    const result = await controller.createNote(
      'secret',
      { text: ' hello note ', date: '2026-05-21T10:00:00.000Z' },
      {
        path: imagePath,
        originalname: 'image.jpg',
        mimetype: 'image/jpeg',
        size: 5,
      },
    );

    expect(storageService.uploadFile).toHaveBeenCalledWith(
      Buffer.from('image'),
      'image/jpeg',
      150847737,
    );
    expect(prisma.note.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'hello note',
          chatId: 150847737,
          images: {
            create: {
              url: 'https://example.com/image.jpg',
              description: 'hello note',
            },
          },
        }),
      }),
    );
    expect(result).toEqual({
      id: 10,
      chatId: 150847737,
      text: 'hello note',
      date: '2026-05-21T10:00:00.000Z',
      imageUrl: 'https://example.com/image.jpg',
    });
  });

  it('rejects requests with a wrong API key', async () => {
    await expect(
      controller.createNote('wrong', {
        text: 'hello',
        date: '2026-05-21T10:00:00.000Z',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
