import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiaryApiController } from './diary-api.controller';
import { PrismaService } from './prisma/prisma.service';

const DIARY_CHAT_ID = 150847737n;

describe('DiaryApiController', () => {
  let controller: DiaryApiController;
  let prisma: {
    $queryRaw: jest.Mock;
    note: { findMany: jest.Mock; updateMany: jest.Mock };
    embedding: { deleteMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      note: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      embedding: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    controller = new DiaryApiController(prisma as unknown as PrismaService);
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
});
