import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import type { Request } from 'express';
import { StorageService } from './services/storage.service';

type UploadedVideo = {
  hash: string;
  pageUrl: string;
  absolutePageUrl: string;
  videoUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

type MulterDiskFile = {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
};

@Controller('subs-api')
export class SubsController {
  constructor(private readonly storageService: StorageService) {}

  @Post('videos')
  @UseInterceptors(
    FileInterceptor('video', {
      dest: tmpdir(),
      limits: {
        fileSize: 1024 * 1024 * 1024,
      },
      fileFilter: (_req, file, callback) => {
        if (file.mimetype.startsWith('video/')) {
          callback(null, true);
          return;
        }

        callback(
          new BadRequestException('Only video files are supported'),
          false,
        );
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: MulterDiskFile | undefined,
    @Req() req: Request,
  ): Promise<UploadedVideo> {
    if (!file) {
      throw new BadRequestException('Video file is required');
    }

    const hash = this.createHash();

    try {
      const videoUrl = await this.storageService.uploadSubsVideoStream(
        createReadStream(file.path),
        file.mimetype,
        hash,
      );

      return {
        hash,
        pageUrl: `/subs/${hash}`,
        absolutePageUrl: this.getAbsolutePageUrl(req, hash),
        videoUrl,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        createdAt: new Date().toISOString(),
      };
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Get('videos/:hash')
  getVideo(@Param('hash') hash: string, @Req() req: Request) {
    this.assertHash(hash);

    return {
      hash,
      pageUrl: `/subs/${hash}`,
      absolutePageUrl: this.getAbsolutePageUrl(req, hash),
      videoUrl: this.storageService.getSubsVideoUrl(hash),
    };
  }

  private createHash(): string {
    return randomBytes(12).toString('hex');
  }

  private assertHash(hash: string): void {
    if (!/^[a-f0-9]{24}$/.test(hash)) {
      throw new BadRequestException('Invalid video hash');
    }
  }

  private getAbsolutePageUrl(req: Request, hash: string): string {
    const forwardedProto = req.header('x-forwarded-proto');
    const proto = forwardedProto?.split(',')[0]?.trim() || req.protocol;
    return `${proto}://${req.get('host')}/subs/${hash}`;
  }
}
