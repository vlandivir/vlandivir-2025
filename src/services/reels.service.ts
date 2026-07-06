import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Prisma } from '../generated/prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

// The subset of `yt-dlp --dump-single-json` output we care about
type YtDlpInfo = {
  title?: string;
  description?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  timestamp?: number;
  upload_date?: string; // YYYYMMDD
  duration?: number;
  thumbnail?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  width?: number;
  height?: number;
  webpage_url?: string;
};

const YTDLP_TIMEOUT_MS = 3 * 60 * 1000;

@Injectable()
export class ReelsService {
  private readonly logger = new Logger(ReelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  extractShortcode(instagramUrl: string): string | null {
    const match =
      /instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/.exec(
        instagramUrl,
      );
    return match ? match[1] : null;
  }

  // Fire-and-forget: the HTTP request returns immediately with a pending
  // record while yt-dlp works in the background; the frontend polls.
  processInBackground(reelId: number): void {
    this.process(reelId).catch(async (error) => {
      this.logger.error(`Reel ${reelId} processing failed: ${String(error)}`);
      await this.prisma.reel
        .update({
          where: { id: reelId },
          data: { status: 'error', error: this.userMessage(error) },
        })
        .catch(() => undefined);
    });
  }

  private async process(reelId: number): Promise<void> {
    const reel = await this.prisma.reel.findUnique({ where: { id: reelId } });
    if (!reel) return;

    const canonicalUrl = `https://www.instagram.com/reel/${reel.shortcode}/`;

    const info = await this.fetchInfo(canonicalUrl);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'reel-'));
    try {
      const videoPath = await this.downloadVideo(canonicalUrl, tempDir);
      const videoUrl = await this.storageService.uploadStreamWithKey(
        createReadStream(videoPath),
        'video/mp4',
        `reels/videos/${reel.shortcode}.mp4`,
      );

      const coverUrl = await this.persistCover(reel.shortcode, info.thumbnail);

      await this.prisma.reel.update({
        where: { id: reelId },
        data: {
          status: 'ready',
          error: null,
          title: info.title || null,
          description: info.description || null,
          // For Instagram yt-dlp puts the username in `channel` and the
          // display name in `uploader`
          author: info.channel || info.uploader || null,
          publishedAt: this.parsePublishedAt(info),
          duration: typeof info.duration === 'number' ? info.duration : null,
          videoUrl,
          coverUrl,
          meta: this.trimInfo(info) as Prisma.InputJsonValue,
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async fetchInfo(url: string): Promise<YtDlpInfo> {
    const stdout = await this.runYtDlp([
      '--dump-single-json',
      '--no-download',
      '--no-warnings',
      '--no-playlist',
      url,
    ]);
    return JSON.parse(stdout) as YtDlpInfo;
  }

  private async downloadVideo(url: string, tempDir: string): Promise<string> {
    await this.runYtDlp([
      '-f',
      'best[ext=mp4]/best',
      '--no-playlist',
      '--no-warnings',
      '-o',
      path.join(tempDir, 'video.%(ext)s'),
      url,
    ]);

    const files = await readdir(tempDir);
    const video = files.find((file) => file.startsWith('video.'));
    if (!video) {
      throw new Error('yt-dlp finished but produced no video file');
    }
    return path.join(tempDir, video);
  }

  // Instagram thumbnail URLs are signed and expire — keep our own copy
  private async persistCover(
    shortcode: string,
    thumbnailUrl: string | undefined,
  ): Promise<string | null> {
    if (!thumbnailUrl) return null;
    try {
      const response = await fetch(thumbnailUrl);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      return await this.storageService.uploadFileWithKey(
        buffer,
        contentType,
        `reels/covers/${shortcode}.jpg`,
      );
    } catch {
      return null;
    }
  }

  private runYtDlp(args: string[]): Promise<string> {
    const binary = this.configService.get<string>('YTDLP_PATH') || 'yt-dlp';
    const cookiesFile = this.configService.get<string>('YTDLP_COOKIES_FILE');
    const fullArgs = cookiesFile ? ['--cookies', cookiesFile, ...args] : args;

    return new Promise<string>((resolve, reject) => {
      const child = spawn(binary, fullArgs, {
        timeout: YTDLP_TIMEOUT_MS,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('yt-dlp is not installed on the server'));
        } else {
          reject(error);
        }
      });
      child.on('close', (code, signal) => {
        if (code === 0) {
          resolve(stdout);
        } else if (signal) {
          reject(new Error(`yt-dlp timed out (${signal})`));
        } else {
          const lastLine =
            stderr
              .trim()
              .split('\n')
              .filter(Boolean)
              .pop()
              ?.replace(/^ERROR:\s*/, '') || `yt-dlp exited with code ${code}`;
          reject(new Error(lastLine));
        }
      });
    });
  }

  private parsePublishedAt(info: YtDlpInfo): Date | null {
    if (typeof info.timestamp === 'number') {
      return new Date(info.timestamp * 1000);
    }
    if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
      const iso = `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`;
      const date = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  // The full dump-json is hundreds of KB (formats list etc.) — keep the
  // fields that matter for the notebook
  private trimInfo(info: YtDlpInfo): Record<string, unknown> {
    return {
      title: info.title,
      description: info.description,
      uploader: info.uploader,
      uploaderId: info.uploader_id,
      channel: info.channel,
      timestamp: info.timestamp,
      duration: info.duration,
      viewCount: info.view_count,
      likeCount: info.like_count,
      commentCount: info.comment_count,
      width: info.width,
      height: info.height,
      webpageUrl: info.webpage_url,
    };
  }

  private userMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 500);
  }
}
