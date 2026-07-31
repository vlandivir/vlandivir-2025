import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as exifr from 'exifr';
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
  takenAt?: Date | null;
  cameraModel?: string | null;
  width?: number | null;
  height?: number | null;
};

type CaptureMeta = {
  takenAt?: Date | null;
  cameraModel?: string | null;
  width?: number | null;
  height?: number | null;
};

@Injectable()
export class TripThumbsService {
  private readonly logger = new Logger(TripThumbsService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /** Generate thumb if missing and backfill capture metadata when possible. */
  async ensureThumb(media: ThumbSource): Promise<string | null> {
    try {
      if (media.kind === 'video') {
        return await this.ensureVideoThumbAndMeta(media);
      }
      return await this.ensurePhotoThumbAndMeta(media);
    } catch (error) {
      this.logger.warn(
        `Trip thumb/meta failed for ${media.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return media.thumbUrl;
    }
  }

  /** Fire-and-forget after upload so the API can respond quickly. */
  generateInBackground(media: ThumbSource): void {
    void this.ensureThumb(media);
  }

  private async ensurePhotoThumbAndMeta(
    media: ThumbSource,
  ): Promise<string | null> {
    if (media.thumbUrl && media.cameraModel != null) {
      return media.thumbUrl;
    }

    const size = Number(media.size);
    if (Number.isFinite(size) && size > MAX_IMAGE_BYTES_FOR_THUMB) {
      this.logger.warn(
        `Skip image thumb for ${media.id}: ${size} bytes too large`,
      );
      if (media.cameraModel == null) {
        await this.prisma.tripMedia.update({
          where: { id: media.id },
          data: { cameraModel: '' },
        });
      }
      return media.thumbUrl;
    }

    const key = this.storage.getTripMediaKey(
      media.tripId,
      media.contentHash,
      media.originalFilename,
    );
    const original = await this.storage.downloadByKey(key);
    const capture = await this.readImageCaptureMeta(original);

    let thumbUrl = media.thumbUrl;
    if (!thumbUrl) {
      const jpeg = await sharp(original)
        .rotate()
        .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
      thumbUrl = await this.storage.uploadTripThumb(
        media.tripId,
        media.contentHash,
        jpeg,
      );
    }

    // cameraModel '' means "inspected, no device tag" so list won't re-scan forever.
    await this.prisma.tripMedia.update({
      where: { id: media.id },
      data: {
        thumbUrl,
        takenAt: media.takenAt ?? capture.takenAt ?? undefined,
        cameraModel: media.cameraModel ?? capture.cameraModel ?? '',
        width: media.width ?? capture.width ?? undefined,
        height: media.height ?? capture.height ?? undefined,
      },
    });
    return thumbUrl;
  }

  private async ensureVideoThumbAndMeta(
    media: ThumbSource,
  ): Promise<string | null> {
    if (media.thumbUrl && media.cameraModel != null) {
      return media.thumbUrl;
    }

    let thumbUrl = media.thumbUrl;
    if (!thumbUrl) {
      const jpeg = await this.thumbFromVideoUrl(media.url);
      if (jpeg?.length) {
        thumbUrl = await this.storage.uploadTripThumb(
          media.tripId,
          media.contentHash,
          jpeg,
        );
      }
    }

    const needsMeta = media.cameraModel == null;
    const capture = needsMeta ? await this.readVideoCaptureMeta(media.url) : {};

    await this.prisma.tripMedia.update({
      where: { id: media.id },
      data: {
        ...(thumbUrl ? { thumbUrl } : {}),
        takenAt: media.takenAt ?? capture.takenAt ?? undefined,
        ...(needsMeta ? { cameraModel: capture.cameraModel ?? '' } : {}),
      },
    });
    return thumbUrl;
  }

  private async readImageCaptureMeta(buffer: Buffer): Promise<CaptureMeta> {
    const meta: CaptureMeta = {};
    try {
      const image = sharp(buffer);
      const sharpMeta = await image.metadata();
      if (sharpMeta.width) meta.width = sharpMeta.width;
      if (sharpMeta.height) meta.height = sharpMeta.height;
    } catch {
      // ignore
    }

    try {
      const exif = (await exifr.parse(buffer, {
        pick: [
          'DateTimeOriginal',
          'CreateDate',
          'ModifyDate',
          'Make',
          'Model',
          'LensModel',
        ],
      })) as Record<string, unknown> | undefined;
      if (!exif) return meta;

      const taken =
        exif.DateTimeOriginal instanceof Date
          ? exif.DateTimeOriginal
          : exif.CreateDate instanceof Date
            ? exif.CreateDate
            : exif.ModifyDate instanceof Date
              ? exif.ModifyDate
              : null;
      if (taken && !Number.isNaN(taken.getTime())) meta.takenAt = taken;

      const make = typeof exif.Make === 'string' ? exif.Make.trim() : '';
      const model = typeof exif.Model === 'string' ? exif.Model.trim() : '';
      let camera = [make, model].filter(Boolean).join(' ');
      if (make && model.toLowerCase().startsWith(make.toLowerCase())) {
        camera = model;
      }
      if (camera) meta.cameraModel = camera.slice(0, 120);
    } catch {
      // Many phone formats still work via sharp rotate; EXIF optional.
    }
    return meta;
  }

  private async readVideoCaptureMeta(url: string): Promise<CaptureMeta> {
    try {
      const json = await this.runFfprobeJson(url);
      const tags = {
        ...(json.format?.tags || {}),
        ...(json.streams?.[0]?.tags || {}),
      } as Record<string, string>;
      const raw =
        tags.creation_time ||
        tags.com_apple_quicktime_creationdate ||
        tags.date ||
        '';
      const takenAt = raw ? new Date(raw) : null;
      const make = (tags.make || tags.com_apple_quicktime_make || '').trim();
      const model = (tags.model || tags.com_apple_quicktime_model || '').trim();
      let camera = [make, model].filter(Boolean).join(' ');
      if (make && model.toLowerCase().startsWith(make.toLowerCase())) {
        camera = model;
      }
      return {
        takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
        cameraModel: camera ? camera.slice(0, 120) : null,
      };
    } catch {
      return {};
    }
  }

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

  private runFfprobeJson(url: string): Promise<{
    format?: { tags?: Record<string, string> };
    streams?: Array<{ tags?: Record<string, string> }>;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'ffprobe',
        [
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          url,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `ffprobe exited with ${code}`));
          return;
        }
        try {
          resolve(
            JSON.parse(stdout) as {
              format?: { tags?: Record<string, string> };
              streams?: Array<{ tags?: Record<string, string> }>;
            },
          );
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
