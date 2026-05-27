import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHome(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'home', 'index.html'));
  }

  @Get('en')
  getHomeEn(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'home', 'en.html'));
  }

  @Get('health')
  getHealth(): string {
    return this.appService.getHello();
  }

  @Get('home')
  getHomeAlias(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'home', 'index.html'));
  }

  @Get('home/en')
  getHomeEnAlias(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'home', 'en.html'));
  }

  @Get('subs')
  getSubs(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'subs', 'index.html'));
  }

  @Get('subs/en')
  getSubsEn(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'subs', 'en.html'));
  }

  @Get('subs/en/:hash')
  getSubsEnVideoPage(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'subs', 'en.html'));
  }

  @Get('subs/:hash')
  getSubsVideoPage(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'subs', 'index.html'));
  }

  @Get('font')
  getFontPicker(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'subs', 'font', 'index.html'));
  }

  @Get('subs/archive')
  getSubsArchive(@Res() res: Response): void {
    res.sendFile(
      path.join(process.cwd(), 'web', 'subs', 'archive', 'index.html'),
    );
  }

  @Get('files')
  getFiles(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'files', 'index.html'));
  }

  @Get('files/en')
  getFilesEn(@Res() res: Response): void {
    res.sendFile(path.join(process.cwd(), 'web', 'files', 'en.html'));
  }
}
