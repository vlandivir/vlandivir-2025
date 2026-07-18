import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  login(
    @Query('redirect') redirect: string | undefined,
    @Res() response: Response,
  ) {
    this.ensureEnabled();
    const { state, nonce } = this.authService.createState(redirect || '/');
    response.setHeader('Set-Cookie', this.authService.stateCookie(nonce));
    response.redirect(this.authService.buildAuthUrl(state));
  }

  @Get('google/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    this.ensureEnabled();
    if (error || !code || !state) {
      response
        .status(400)
        .send(`Google sign-in failed: ${error || 'missing code'}`);
      return;
    }

    const cookies = this.authService.parseCookies(request.headers.cookie);
    const verifiedState = this.authService.verifyState(
      state,
      cookies[this.authService.stateCookieName],
    );
    if (!verifiedState) {
      response.status(400).send('Google sign-in failed: invalid state');
      return;
    }

    const result = await this.authService.handleCallback(code);
    if (result === 'forbidden') {
      response.setHeader('Set-Cookie', [
        this.authService.clearedStateCookie(),
        this.authService.clearedSessionCookie(),
      ]);
      response
        .status(403)
        .send('This Google account is not allowed to access this site.');
      return;
    }

    const token = this.authService.issueSessionToken(result);
    response.setHeader('Set-Cookie', [
      this.authService.sessionCookie(token),
      this.authService.clearedStateCookie(),
    ]);
    response.redirect(verifiedState.redirectPath);
  }

  @Get('logout')
  logout(@Res() response: Response) {
    response.setHeader('Set-Cookie', this.authService.clearedSessionCookie());
    response.redirect('/');
  }

  @Get('me')
  me(@Req() request: Request, @Res() response: Response) {
    const user = this.authService.getSessionFromRequest(request);
    if (!user) {
      response.status(401).json({ authenticated: false });
      return;
    }
    response.json({ authenticated: true, ...user });
  }

  private ensureEnabled() {
    if (!this.authService.enabled) {
      throw new ServiceUnavailableException('Google auth is not configured');
    }
  }
}
