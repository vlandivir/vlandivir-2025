import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma/prisma.service';
import { ReelsService } from './services/reels.service';

@Controller('reels-api')
export class ReelsApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly reelsService: ReelsService,
  ) {}

  @Get('reels')
  async listReels(@Headers('x-reels-page-key') pageKey: string | undefined) {
    this.assertPageKey(pageKey);
    return this.prisma.reel.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get('reels/:id')
  async getReel(
    @Headers('x-reels-page-key') pageKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertPageKey(pageKey);
    const reel = await this.prisma.reel.findUnique({ where: { id } });
    if (!reel) throw new NotFoundException('Reel not found');
    return reel;
  }

  @Post('reels')
  async createReel(
    @Headers('x-reels-api-key') apiKey: string | undefined,
    @Body() body: { instagramUrl?: string },
  ) {
    this.assertEditKey(apiKey);

    const instagramUrl = (body.instagramUrl || '').trim();
    const shortcode = this.reelsService.extractShortcode(instagramUrl);
    if (!shortcode) {
      throw new BadRequestException(
        'Нужна ссылка на Instagram reel (instagram.com/reel/…)',
      );
    }

    const existing = await this.prisma.reel.findUnique({
      where: { shortcode },
    });
    if (existing) {
      // A failed attempt can be retried by re-submitting the same link
      if (existing.status === 'error') {
        const restarted = await this.prisma.reel.update({
          where: { id: existing.id },
          data: { status: 'pending', error: null },
        });
        this.reelsService.processInBackground(existing.id);
        return restarted;
      }
      throw new BadRequestException('Этот ролик уже добавлен');
    }

    const reel = await this.prisma.reel.create({
      data: { instagramUrl, shortcode },
    });
    this.reelsService.processInBackground(reel.id);
    return reel;
  }

  @Post('reels/:id/retry')
  async retryReel(
    @Headers('x-reels-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertEditKey(apiKey);
    const reel = await this.prisma.reel.findUnique({ where: { id } });
    if (!reel) throw new NotFoundException('Reel not found');

    const restarted = await this.prisma.reel.update({
      where: { id },
      data: { status: 'pending', error: null },
    });
    this.reelsService.processInBackground(id);
    return restarted;
  }

  // Re-run transcription for every downloaded reel (sequential, background)
  @Post('transcribe-all')
  async transcribeAll(@Headers('x-reels-api-key') apiKey: string | undefined) {
    this.assertEditKey(apiKey);
    const queued = await this.reelsService.transcribeAllInBackground();
    return { queued };
  }

  // Force audio extraction + Whisper transcription for an already
  // downloaded reel
  @Post('reels/:id/transcribe')
  async transcribeReel(
    @Headers('x-reels-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertEditKey(apiKey);
    const reel = await this.prisma.reel.findUnique({ where: { id } });
    if (!reel) throw new NotFoundException('Reel not found');
    if (reel.status !== 'ready' || !reel.videoUrl) {
      throw new BadRequestException(
        'Сначала должно загрузиться видео — распознавать пока нечего',
      );
    }

    const updated = await this.prisma.reel.update({
      where: { id },
      data: { transcriptStatus: 'pending', transcriptError: null },
    });
    this.reelsService.transcribeInBackground(id);
    return updated;
  }

  // Assign tags for every analyzed reel (sequential, background). Sequential
  // matters: the dictionary grows as we go, so later reels reuse tags
  // created for earlier ones instead of inventing near-duplicates.
  @Post('generate-tags')
  async generateTags(@Headers('x-reels-api-key') apiKey: string | undefined) {
    this.assertEditKey(apiKey);
    const reels = await this.prisma.reel.findMany({
      where: { status: 'ready' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    void (async () => {
      for (const { id } of reels) {
        await this.reelsService.generateTags(id).catch(() => undefined);
      }
    })();
    return { queued: reels.length };
  }

  // Regenerate titles for every analyzed reel (sequential, background)
  @Post('generate-titles')
  async generateTitles(@Headers('x-reels-api-key') apiKey: string | undefined) {
    this.assertEditKey(apiKey);
    const reels = await this.prisma.reel.findMany({
      where: { status: 'ready' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    void (async () => {
      for (const { id } of reels) {
        await this.reelsService.generateTitle(id).catch(() => undefined);
      }
    })();
    return { queued: reels.length };
  }

  // Force frame extraction + LLM description for an already downloaded reel
  @Post('reels/:id/vision')
  async visionReel(
    @Headers('x-reels-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertEditKey(apiKey);
    const reel = await this.prisma.reel.findUnique({ where: { id } });
    if (!reel) throw new NotFoundException('Reel not found');
    if (reel.status !== 'ready' || !reel.videoUrl) {
      throw new BadRequestException(
        'Сначала должно загрузиться видео — разбирать пока нечего',
      );
    }

    const updated = await this.prisma.reel.update({
      where: { id },
      data: { visionStatus: 'pending', visionError: null },
    });
    this.reelsService.visionInBackground(id);
    return updated;
  }

  @Delete('reels/:id')
  async deleteReel(
    @Headers('x-reels-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertEditKey(apiKey);
    const reel = await this.prisma.reel.findUnique({ where: { id } });
    if (!reel) throw new NotFoundException('Reel not found');

    await this.prisma.reel.delete({ where: { id } });
    return { deleted: true };
  }

  @Post('key-check')
  checkKey(@Headers('x-reels-api-key') apiKey: string | undefined) {
    this.assertEditKey(apiKey);
    return { ok: true };
  }

  // The page itself is unlisted: reading the catalog requires the secret
  // from the page URL
  private assertPageKey(receivedKey?: string): void {
    const expectedKey = this.configService.get<string>('REELS_PAGE_KEY');
    if (!expectedKey) {
      throw new InternalServerErrorException(
        'REELS_PAGE_KEY is not configured',
      );
    }
    if (!receivedKey || !this.isSameSecret(receivedKey, expectedKey)) {
      throw new UnauthorizedException('Invalid page key');
    }
  }

  private assertEditKey(receivedKey?: string): void {
    const expectedKey =
      this.configService.get<string>('REELS_API_KEY') ||
      this.configService.get<string>('MAP_API_KEY') ||
      this.configService.get<string>('NOTE_API_KEY');
    if (!expectedKey) {
      throw new InternalServerErrorException('REELS_API_KEY is not configured');
    }
    if (!receivedKey || !this.isSameSecret(receivedKey, expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
  }

  private isSameSecret(receivedKey: string, expectedKey: string): boolean {
    const received = Buffer.from(receivedKey);
    const expected = Buffer.from(expectedKey);
    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  }
}
