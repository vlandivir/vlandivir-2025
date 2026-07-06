import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';

// The reels notebook is unlisted: the page lives at /reels/<REELS_PAGE_KEY>
// and any other path under /reels/ is a 404. The frontend reads the secret
// from its own URL and passes it to /reels-api as the read key.
@Controller('reels')
export class ReelsPagesController {
  constructor(private readonly configService: ConfigService) {}

  @Get(':secret')
  async page(@Param('secret') secret: string, @Res() res: Response) {
    const expected = this.configService.get<string>('REELS_PAGE_KEY');
    if (!expected || !this.isSameSecret(secret, expected)) {
      throw new NotFoundException();
    }

    const html = await readFile(
      path.join(process.cwd(), 'web', 'reels', 'index.html'),
      'utf8',
    );
    res.type('html').send(html);
  }

  private isSameSecret(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    if (receivedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}
