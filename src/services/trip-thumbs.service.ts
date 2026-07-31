import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

const THUMB_MAX_EDGE = 480;
const THUMB_JPEG_QUALITY = 72;
const MAX_IMAGE_BYTES_FOR_THUMB = 40 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 45_000;

type ThumbSource = {
  id: string;
  tripId: string;
  contentHash: string;
  url: string;
  mimeType: string;
  size: bigint | number;
  originalFilename: string;
  kind: string;
  thumbUrl: string | null;
};

@Injectable()
export class TripThumbsService {
  private readonly logger = new Logger(TripThumbsService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /** Generate thumb if missing; returns public URL or null. */
  async ensureThumb(media: ThumbSource): Promise<string | null> {
    if (media.thumbUrl) return media.thumbUrl;

    try {
      const jpeg =
        media.kind === 'video'
          ? await this.thumbFromVideoUrl(media.url)
          : await this.thumbFromImage(media);

      if (!jpeg?.length) return null;

      const thumbUrl = await this.storage.uploadTripThumb(
        media.tripId,
        media.contentHash,
        jpeg,
      );

      await this.prisma.tripMedia.update({
        where: { id: media.id },
        data: { thumbUrl },
      });
      return thumbUrl;
    } catch (error) {
      this.logger.warn(
        `Trip thumb failed for ${media.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Fire-and-forget after upload so the API can respond quickly. */
  generateInBackground(media: ThumbSource): void {
    if (media.thumbUrl) return;
    void this.ensureThumb(media);
  }

  private async thumbFromImage(media: ThumbSource): Promise<Buffer | null> {
    const size = Number(media.size);
    if (Number.isFinite(size) && size > MAX_IMAGE_BYTES_FOR_THUMB) {
      this.logger.warn(
        `Skip image thumb for ${media.id}: ${size} bytes too large`,
      );
      return null;
    }

    const key = this.storage.getTripMediaKey(
      media.tripId,
      media.contentHash,
      media.originalFilename,
    );
    const original = await this.storage.downloadByKey(key);
    return sharp(original)
      .rotate()
      .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  }

  /** Pull one frame via ffmpeg HTTP input — does not download the whole video. */
  private async thumbFromVideoUrl(url: string): Promise<Buffer | null> {
    const dir = await mkdtemp(join(tmpdir(), 'trip-thumb-'));
    const outPath = join(dir, 'thumb.jpg');
    try {
      await this.runFfmpeg([
        '-y',
        '-ss',
        '0.8',
        '-i',
        url,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${THUMB_MAX_EDGE},iw)':-2`,
        '-q:v',
        '5',
        outPath,
      ]);
      const frame = await readFile(outPath);
      // Normalize through sharp for consistent JPEG size/quality.
      return sharp(frame)
        .rotate()
        .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('ffmpeg is not installed on the server'));
        } else {
          reject(error);
        }
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          const lastLine =
            stderr.trim().split('\n').filter(Boolean).pop() ||
            `ffmpeg exited with code ${code}`;
          reject(new Error(lastLine));
        }
      });
    });
  }
}
