import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { AuthService } from './auth/auth.service';
import { GoogleSessionGuard } from './auth/google-session.guard';

// The diary app lives at /diary behind Google sign-in. /diary is the calendar
// and /diary/MM-DD is one day-of-month across years; both are the same SPA.
@Controller('diary')
export class DiaryPagesController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(GoogleSessionGuard)
  @Get()
  async page(@Res() res: Response) {
    res.type('html').send(await this.loadHtml());
  }

  // /diary/MM-DD — deep link to one day; anything else goes to the calendar.
  @Get(':day')
  async dayPage(
    @Param('day') day: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!/^\d{2}-\d{2}$/.test(day)) {
      res.redirect('/diary');
      return;
    }
    if (!this.requireSession(req, res)) return;
    res.type('html').send(await this.loadHtml());
  }

  private requireSession(req: Request, res: Response): boolean {
    if (this.authService.getSessionFromRequest(req)) return true;
    const redirect = encodeURIComponent(
      this.authService.safeRedirectPath(req.originalUrl),
    );
    res.redirect(`/auth/google?redirect=${redirect}`);
    return false;
  }

  private loadHtml(): Promise<string> {
    return readFile(
      path.join(process.cwd(), 'web', 'diary', 'index.html'),
      'utf8',
    );
  }
}
