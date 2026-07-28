import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DiaryApiController } from './diary-api.controller';
import { PrismaService } from './prisma/prisma.service';
import { LlmService } from './services/llm.service';
import { StorageService } from './services/storage.service';

const DIARY_CHAT_ID = 150847737n;

describe('DiaryApiController', () => {
  let controller: DiaryApiController;
  let prisma: {
    $queryRaw: jest.Mock;
    note: { findMany: jest.Mock; updateMany: jest.Mock };
    image: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    video: { updateMany: jest.Mock };
    embedding: { deleteMany: jest.Mock };
  };
  let llmService: {
    describeImage: jest.Mock;
    refineHandwrittenText: jest.Mock;
    recognizeHandwriting: jest.Mock;
  };
  let storageService: {
    downloadFile: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      note: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      image: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      video: {
        updateMany: jest.fn(),
      },
      embedding: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    llmService = {
      describeImage: jest.fn(),
      refineHandwrittenText: jest.fn(),
      recognizeHandwriting: jest.fn(),
    };
    storageService = {
      downloadFile: jest.fn(),
    };
    controller = new DiaryApiController(
      prisma as unknown as PrismaService,
      llmService as unknown as LlmService,
      storageService as unknown as StorageService,
    );
  });

  describe('calendar', () => {
    it('returns day-of-month rows scoped to the diary chat', async () => {
      prisma.$queryRaw.mockResolvedValue([{ month: 7, day: 24, count: 3 }]);

      const result = await controller.calendar();

      expect(result).toEqual({ days: [{ month: 7, day: 24, count: 3 }] });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('day', () => {
    it('rejects an out-of-range month or day', async () => {
      await expect(controller.day('13', '1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(controller.day('7', '40')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.note.findMany).not.toHaveBeenCalled();
    });

    it('groups notes by year, newest first, scoped to the chat', async () => {
      const currentYear = new Date().getFullYear();
      prisma.note.findMany.mockImplementation(({ where }) => {
        expect(where.chatId).toBe(DIARY_CHAT_ID);
        const year = where.noteDate.gte.getFullYear();
        if (year === currentYear) {
          return Promise.resolve([
            {
              id: 1,
              content: 'now',
              noteDate: new Date(),
              images: [],
              videos: [],
            },
          ]);
        }
        if (year === currentYear - 1) {
          return Promise.resolve([
            {
              id: 2,
              content: 'last year',
              noteDate: new Date(),
              images: [],
              videos: [],
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await controller.day('7', '24');

      expect(result.month).toBe(7);
      expect(result.day).toBe(24);
      expect(result.years.map((y) => y.year)).toEqual([
        currentYear,
        currentYear - 1,
      ]);
      // chatId must never leak into the response (BigInt is not serializable).
      expect(JSON.stringify(result.years)).not.toContain('chatId');
    });
  });

  describe('updateNote', () => {
    it('requires a string content', async () => {
      await expect(
        controller.updateNote(1, {} as { content?: string }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
    });

    it('updates the note scoped to the chat and drops its embedding', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 1 });

      const result = await controller.updateNote(5, { content: 'edited' });

      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 5, chatId: DIARY_CHAT_ID },
        data: { content: 'edited' },
      });
      expect(prisma.embedding.deleteMany).toHaveBeenCalledWith({
        where: { kind: 'note', refId: 5 },
      });
      expect(result).toEqual({ id: 5, content: 'edited' });
    });

    it('404s when no owned note matches', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        controller.updateNote(999, { content: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.embedding.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('updateImage', () => {
    it('requires a string description', async () => {
      await expect(
        controller.updateImage(1, {} as { description?: string }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.image.updateMany).not.toHaveBeenCalled();
    });

    it('updates the image scoped via its note and drops the embedding', async () => {
      prisma.image.updateMany.mockResolvedValue({ count: 1 });

      const result = await controller.updateImage(7, { description: 'text' });

      expect(prisma.image.updateMany).toHaveBeenCalledWith({
        where: { id: 7, note: { chatId: DIARY_CHAT_ID } },
        data: { description: 'text' },
      });
      expect(prisma.embedding.deleteMany).toHaveBeenCalledWith({
        where: { kind: 'image', refId: 7 },
      });
      expect(result).toEqual({ id: 7, description: 'text' });
    });

    it('404s when no owned image matches', async () => {
      prisma.image.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        controller.updateImage(999, { description: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.embedding.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('updateVideo', () => {
    it('requires a string description', async () => {
      await expect(
        controller.updateVideo(1, {} as { description?: string }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.video.updateMany).not.toHaveBeenCalled();
    });

    it('updates the video scoped via its note (no embedding to drop)', async () => {
      prisma.video.updateMany.mockResolvedValue({ count: 1 });

      const result = await controller.updateVideo(9, { description: 'clip' });

      expect(prisma.video.updateMany).toHaveBeenCalledWith({
        where: { id: 9, note: { chatId: DIARY_CHAT_ID } },
        data: { description: 'clip' },
      });
      expect(prisma.embedding.deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 9, description: 'clip' });
    });

    it('404s when no owned video matches', async () => {
      prisma.video.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        controller.updateVideo(999, { description: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('describeImage', () => {
    it('404s when the image is not owned', async () => {
      prisma.image.findFirst.mockResolvedValue(null);

      await expect(controller.describeImage(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storageService.downloadFile).not.toHaveBeenCalled();
    });

    it('recognises, refines, persists and returns the description', async () => {
      prisma.image.findFirst.mockResolvedValue({
        id: 3,
        url: 'https://spaces/x.jpg',
        note: { content: 'дневник' },
      });
      storageService.downloadFile.mockResolvedValue(Buffer.from('img'));
      llmService.recognizeHandwriting.mockResolvedValue('чистый текст');

      const result = await controller.describeImage(3);

      expect(storageService.downloadFile).toHaveBeenCalledWith(
        'https://spaces/x.jpg',
      );
      expect(llmService.recognizeHandwriting).toHaveBeenCalledWith(
        expect.any(Buffer),
        'дневник',
        { reasoningEffort: 'medium' },
      );
      expect(prisma.image.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { description: 'чистый текст' },
      });
      expect(prisma.embedding.deleteMany).toHaveBeenCalledWith({
        where: { kind: 'image', refId: 3 },
      });
      expect(result).toEqual({ id: 3, description: 'чистый текст' });
    });

    it('does not persist an LLM failure sentinel', async () => {
      prisma.image.findFirst.mockResolvedValue({
        id: 4,
        url: 'https://spaces/y.jpg',
        note: { content: null },
      });
      storageService.downloadFile.mockResolvedValue(Buffer.from('img'));
      llmService.recognizeHandwriting.mockResolvedValue(
        'Не удалось описать изображение',
      );

      await expect(controller.describeImage(4)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(prisma.image.update).not.toHaveBeenCalled();
    });
  });
});
