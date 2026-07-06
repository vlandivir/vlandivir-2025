import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { PrismaService } from './prisma/prisma.service';

// The reels notebook is unlisted: the page lives at /reels/<REELS_PAGE_KEY>
// (optionally /reels/<key>/<reelId> for share links) and any other path under
// /reels/ is a 404. The frontend reads the secret from its own URL and passes
// it to /reels-api as the read key.
@Controller('reels')
export class ReelsPagesController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':secret')
  async page(@Param('secret') secret: string, @Res() res: Response) {
    this.assertSecret(secret);
    res.type('html').send(await this.loadHtml());
  }

  // Share link for a single reel — same SPA with Open Graph tags injected so
  // messengers show the reel title and cover.
  @Get(':secret/:id')
  async reelPage(
    @Param('secret') secret: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    this.assertSecret(secret);
    let html = await this.loadHtml();

    const reelId = Number(id);
    const reel = Number.isInteger(reelId)
      ? await this.prisma.reel.findUnique({ where: { id: reelId } })
      : null;

    if (reel) {
      const title = reel.title || reel.shortcode;
      const description = (reel.description || '').slice(0, 200);
      const tags = [
        `<meta property="og:type" content="video.other" />`,
        `<meta property="og:title" content="${this.escape(title)}" />`,
        ...(description
          ? [
              `<meta property="og:description" content="${this.escape(description)}" />`,
            ]
          : []),
        ...(reel.coverUrl
          ? [
              `<meta property="og:image" content="${this.escape(reel.coverUrl)}" />`,
              `<meta name="twitter:card" content="summary_large_image" />`,
            ]
          : []),
      ].join('\n  ');
      html = html
        .replace(
          /<title>[^<]*<\/title>/,
          `<title>${this.escape(title)}</title>`,
        )
        .replace('</head>', `  ${tags}\n</head>`);
    }

    res.type('html').send(html);
  }

  private loadHtml(): Promise<string> {
    return readFile(
      path.join(process.cwd(), 'web', 'reels', 'index.html'),
      'utf8',
    );
  }

  private assertSecret(secret: string): void {
    const expected = this.configService.get<string>('REELS_PAGE_KEY');
    if (!expected || !this.isSameSecret(secret, expected)) {
      throw new NotFoundException();
    }
  }

  private isSameSecret(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    if (receivedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(receivedBuffer, expectedBuffer);
  }

  private escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
