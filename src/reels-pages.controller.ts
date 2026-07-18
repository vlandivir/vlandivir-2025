import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { AuthService } from './auth/auth.service';
import { GoogleSessionGuard } from './auth/google-session.guard';
import { PrismaService } from './prisma/prisma.service';

// The reels notebook lives at /reels behind Google sign-in (the SPA reads the
// catalog with the session cookie). Legacy unlisted URLs with the page secret
// (/reels/<REELS_PAGE_KEY>[/<reelId>]) keep working so old share links don't
// break; any other path under /reels/ is a 404.
@Controller('reels')
export class ReelsPagesController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  @UseGuards(GoogleSessionGuard)
  @Get()
  async page(@Res() res: Response) {
    res.type('html').send(await this.loadHtml());
  }

  // /reels/<id> — deep link for the owner; /reels/<secret> — legacy page.
  @Get(':idOrSecret')
  async pageOrReel(
    @Param('idOrSecret') idOrSecret: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (/^\d+$/.test(idOrSecret)) {
      if (!this.requireSession(req, res)) return;
      res.type('html').send(await this.reelHtml(Number(idOrSecret)));
      return;
    }
    this.assertSecret(idOrSecret);
    res.type('html').send(await this.loadHtml());
  }

  // Legacy share link for a single reel — same SPA with Open Graph tags
  // injected so messengers show the reel title and cover.
  @Get(':secret/:id')
  async reelPage(
    @Param('secret') secret: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    this.assertSecret(secret);
    res.type('html').send(await this.reelHtml(Number(id)));
  }

  private requireSession(req: Request, res: Response): boolean {
    if (this.authService.getSessionFromRequest(req)) return true;
    const redirect = encodeURIComponent(
      this.authService.safeRedirectPath(req.originalUrl),
    );
    res.redirect(`/auth/google?redirect=${redirect}`);
    return false;
  }

  private async reelHtml(reelId: number): Promise<string> {
    let html = await this.loadHtml();

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

    return html;
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
