import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { PrismaService } from './prisma/prisma.service';

// Serves the map SPA for share links like /serbia-map/point/3 with
// per-feature Open Graph tags injected, so messengers and social networks
// show a proper title, description and cover preview.
@Controller('serbia-map')
export class MapPagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('point/:id')
  async pointPage(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.sendPage('point', Number(id), req, res);
  }

  @Get('track/:id')
  async trackPage(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.sendPage('track', Number(id), req, res);
  }

  private async sendPage(
    kind: 'point' | 'track',
    id: number,
    req: Request,
    res: Response,
  ) {
    const html = await readFile(
      path.join(process.cwd(), 'web', 'serbia-map', 'index.html'),
      'utf8',
    );

    const record = Number.isInteger(id)
      ? kind === 'point'
        ? await this.prisma.mapPoint.findUnique({ where: { id } })
        : await this.prisma.mapTrack.findUnique({ where: { id } })
      : null;

    if (!record) {
      res.type('html').send(html);
      return;
    }

    const meta = record.instagramMeta as {
      caption?: string;
      coverUrl?: string;
      thumbnailUrl?: string;
      username?: string;
    } | null;

    const baseUrl =
      process.env.VLANDIVIR_2025_BASE_URL ||
      `${req.protocol}://${req.get('host')}`;
    const title = `${record.name} — Карта интересных мест Сербии`;
    const description =
      record.description ||
      meta?.caption ||
      'Интерактивная карта интересных мест Сербии с видео из Instagram';
    const image = meta?.coverUrl || meta?.thumbnailUrl;

    const tags = [
      `<meta property="og:type" content="article" />`,
      `<meta property="og:title" content="${this.escape(title)}" />`,
      `<meta property="og:description" content="${this.escape(description)}" />`,
      `<meta property="og:url" content="${this.escape(`${baseUrl}/serbia-map/${kind}/${record.id}`)}" />`,
      ...(image
        ? [
            `<meta property="og:image" content="${this.escape(image)}" />`,
            `<meta name="twitter:card" content="summary_large_image" />`,
          ]
        : []),
    ].join('\n  ');

    const page = html
      .replace(/<title>[^<]*<\/title>/, `<title>${this.escape(title)}</title>`)
      .replace('</head>', `  ${tags}\n</head>`);
    res.type('html').send(page);
  }

  private escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
