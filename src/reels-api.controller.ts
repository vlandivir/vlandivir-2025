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
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma/prisma.service';
import { ReelsService } from './services/reels.service';
import { ReelsQaService } from './services/reels-qa.service';

// Same limits as the map API — the tag dictionary is shared
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 50;

@Controller('reels-api')
export class ReelsApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly reelsService: ReelsService,
    private readonly reelsQaService: ReelsQaService,
  ) {}

  @Get('reels')
  async listReels(@Headers('x-reels-page-key') pageKey: string | undefined) {
    this.assertPageKey(pageKey);
    return this.prisma.reel.findMany({ orderBy: { createdAt: 'desc' } });
  }

  // Semantic search over indexed reels: [{id, similarity}], best first.
  // The client merges these with its own substring filtering.
  @Get('search')
  async searchReels(
    @Headers('x-reels-page-key') pageKey: string | undefined,
    @Query('q') q: string | undefined,
  ) {
    this.assertPageKey(pageKey);
    const query = (q || '').trim();
    if (!query) return [];
    return this.reelsService.searchReels(query);
  }

  // RAG Q&A over the notebook: answer + source reels ([#id] refs in text)
  @Get('ask')
  async askReels(
    @Headers('x-reels-page-key') pageKey: string | undefined,
    @Query('q') q: string | undefined,
  ) {
    this.assertPageKey(pageKey);
    const question = (q || '').trim();
    if (!question) throw new BadRequestException('Нужен вопрос (?q=…)');
    const result = await this.reelsQaService.ask(question);
    return result ?? { answer: null, sources: [] };
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

  // Tags are set by hand; unknown names are added to the shared MapTag
  // dictionary (emoji can be picked later in the 🏷 editor on /places)
  @Post('reels/:id/tags')
  async updateReelTags(
    @Headers('x-reels-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { tags?: unknown },
  ) {
    this.assertEditKey(apiKey);
    const reel = await this.prisma.reel.findUnique({ where: { id } });
    if (!reel) throw new NotFoundException('Reel not found');

    const tags = this.parseTags(body.tags);
    for (const name of tags) {
      await this.prisma.mapTag.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    }
    const updated = await this.prisma.reel.update({
      where: { id },
      data: { tags },
    });
    // Tags are part of the search embedding text
    void this.reelsService.indexReel(id).catch(() => undefined);
    return updated;
  }

  private parseTags(tags: unknown): string[] {
    if (tags === undefined || tags === null) return [];
    if (!Array.isArray(tags)) {
      throw new BadRequestException('Tags must be an array of strings');
    }
    const parsed = [
      ...new Set(
        tags.map((tag) => {
          if (typeof tag !== 'string' || !tag.trim()) {
            throw new BadRequestException(
              'Each tag must be a non-empty string',
            );
          }
          if (tag.length > MAX_TAG_LENGTH) {
            throw new BadRequestException(
              `Tags must be at most ${MAX_TAG_LENGTH} characters`,
            );
          }
          return tag.trim().toLowerCase();
        }),
      ),
    ];
    if (parsed.length > MAX_TAGS) {
      throw new BadRequestException(`At most ${MAX_TAGS} tags are allowed`);
    }
    return parsed;
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

  // (Re)compute search embeddings for every analyzed reel (background)
  @Post('embed-all')
  async embedAll(@Headers('x-reels-api-key') apiKey: string | undefined) {
    this.assertEditKey(apiKey);
    const queued = await this.reelsService.embedAllInBackground();
    return { queued };
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
    await this.reelsService.unindexReel(id);
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
