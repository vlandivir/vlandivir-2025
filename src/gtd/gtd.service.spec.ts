import { GtdIdentityProvider } from '../generated/prisma-client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../services/storage.service';
import { GtdService } from './gtd.service';

describe('GtdService', () => {
  const prisma = {} as PrismaService;
  const storage = {} as StorageService;
  const service = new GtdService(prisma, storage);
  const snoozeUntil = (action: string, now: Date): Date =>
    (
      service as unknown as {
        snoozeUntil(action: string, now: Date): Date;
      }
    ).snoozeUntil(action, now);

  it('calculates all snooze presets in UTC', () => {
    const now = new Date('2026-07-31T20:15:00.000Z');
    expect(snoozeUntil('SNOOZE_HOUR', now).toISOString()).toBe(
      '2026-07-31T21:15:00.000Z',
    );
    expect(snoozeUntil('SNOOZE_TOMORROW', now).toISOString()).toBe(
      '2026-08-01T09:00:00.000Z',
    );
    expect(snoozeUntil('SNOOZE_MONDAY', now).toISOString()).toBe(
      '2026-08-03T09:00:00.000Z',
    );
    expect(snoozeUntil('SNOOZE_WEEK', now).toISOString()).toBe(
      '2026-08-07T20:15:00.000Z',
    );
  });

  it('uses the same Monday when 09:00 UTC is still in the future', () => {
    const now = new Date('2026-08-03T08:15:00.000Z');
    expect(snoozeUntil('SNOOZE_MONDAY', now).toISOString()).toBe(
      '2026-08-03T09:00:00.000Z',
    );
  });

  it('merges Telegram tasks after the Google queue without losing order', async () => {
    const taskUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      gtdIdentity: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'google', provider: GtdIdentityProvider.GOOGLE },
          ])
          .mockResolvedValueOnce([
            { id: 'telegram', provider: GtdIdentityProvider.TELEGRAM },
          ]),
        update: jest.fn().mockResolvedValue({}),
      },
      gtdTask: {
        findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
        update: taskUpdate,
      },
      gtdProject: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      gtdWorkspace: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ nextOrder: 3n }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      gtdLinkRequest: { update: jest.fn().mockResolvedValue({}) },
    };
    const mockPrisma = {
      gtdLinkRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'link',
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          telegramIdentity: {
            id: 'telegram',
            provider: GtdIdentityProvider.TELEGRAM,
            providerId: '42',
            workspaceId: 'telegram-workspace',
          },
        }),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const mergeService = new GtdService(mockPrisma, storage);

    await mergeService.confirmLink(
      {
        workspaceId: 'google-workspace',
        identity: {
          id: 'google',
          workspaceId: 'google-workspace',
          provider: GtdIdentityProvider.GOOGLE,
          providerId: 'owner@example.com',
          displayName: 'Owner',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      'a'.repeat(64),
    );

    expect(taskUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 't1' },
      data: { workspaceId: 'google-workspace', orderKey: 4n },
    });
    expect(taskUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 't2' },
      data: { workspaceId: 'google-workspace', orderKey: 5n },
    });
    expect(tx.gtdWorkspace.delete).toHaveBeenCalledWith({
      where: { id: 'telegram-workspace' },
    });
  });
});
