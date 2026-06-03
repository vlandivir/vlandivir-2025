import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Request } from 'express';
import type { Readable } from 'stream';
import { StorageService } from './services/storage.service';
import { SubsController } from './subs.controller';
import { TelegramBotService } from './telegram-bot/telegram-bot.service';

describe('SubsController', () => {
  let controller: SubsController;
  let storageService: {
    uploadSubsVideoStream: jest.Mock;
  };
  let telegramBotService: {
    sendDirectMessage: jest.Mock;
  };
  let tmpDir: string;
  let req: Request;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'subs-controller-test-'));
    storageService = {
      uploadSubsVideoStream: jest.fn().mockImplementation(async (stream: Readable) => {
        for await (const _chunk of stream) {
          // Drain the stream like the real DO upload does before the tmp file is removed.
        }
        return 'https://fra1.digitaloceanspaces.com/vlandivir-2025/subs/videos/hash/source';
      }),
    };
    telegramBotService = {
      sendDirectMessage: jest.fn().mockResolvedValue({ messageId: 123 }),
    };

    controller = new SubsController(
      storageService as unknown as StorageService,
      { get: jest.fn() } as unknown as ConfigService,
      telegramBotService as unknown as TelegramBotService,
    );
    jest
      .spyOn(controller as unknown as { createHash: () => string }, 'createHash')
      .mockReturnValue('aea4b8455e75d098f37454f9');
    jest
      .spyOn(
        controller as unknown as {
          assertUploadVideoMeetsRequirements: () => Promise<void>;
        },
        'assertUploadVideoMeetsRequirements',
      )
      .mockResolvedValue();
    req = {
      protocol: 'https',
      header: jest.fn().mockReturnValue(undefined),
      get: jest.fn().mockReturnValue('vlandivir.com'),
    } as unknown as Request;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sends a Telegram notification after uploading a Subs video to DO storage', async () => {
    const videoPath = join(tmpDir, 'video.mp4');
    await writeFile(videoPath, Buffer.from('video'));

    const result = await controller.uploadVideo(
      {
        path: videoPath,
        originalname: 'ride.mp4',
        mimetype: 'video/mp4',
        size: 5 * 1024 * 1024,
      },
      req,
    );

    expect(result).toEqual(
      expect.objectContaining({
        hash: 'aea4b8455e75d098f37454f9',
        absolutePageUrl:
          'https://vlandivir.com/subs/aea4b8455e75d098f37454f9',
        videoUrl:
          'https://fra1.digitaloceanspaces.com/vlandivir-2025/subs/videos/hash/source',
      }),
    );
    expect(telegramBotService.sendDirectMessage).toHaveBeenCalledWith(
      150847737,
      expect.stringContaining('DO файл: https://fra1.digitaloceanspaces.com/vlandivir-2025/subs/videos/hash/source'),
    );
    expect(telegramBotService.sendDirectMessage).toHaveBeenCalledWith(
      150847737,
      expect.stringContaining(
        'Страница: https://vlandivir.com/subs/aea4b8455e75d098f37454f9',
      ),
    );
  });

  it('keeps the upload response when the Telegram notification fails', async () => {
    const videoPath = join(tmpDir, 'video.mp4');
    await writeFile(videoPath, Buffer.from('video'));
    telegramBotService.sendDirectMessage.mockRejectedValue(
      new Error('Telegram failed'),
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      controller.uploadVideo(
        {
          path: videoPath,
          originalname: 'ride.mp4',
          mimetype: 'video/mp4',
          size: 5,
        },
        req,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        hash: 'aea4b8455e75d098f37454f9',
      }),
    );
  });
});
