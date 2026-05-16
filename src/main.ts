import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AppModule } from './app.module';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';

async function bootstrap() {
  console.log(process.env);

  const environment = process.env.ENVIRONMENT || 'DEV';
  const port = process.env.PORT || 3000;

  if (environment === 'PROD') {
    let httpsOptions: HttpsOptions;

    try {
      httpsOptions = {
        key: fs.readFileSync(
          path.join(process.cwd(), '.secret', 'privkey.pem'),
        ),
        cert: fs.readFileSync(
          path.join(process.cwd(), '.secret', 'fullchain.pem'),
        ),
      };
    } catch (error) {
      console.error('Ошибка при чтении SSL сертификатов:', error);
      process.exit(1);
    }

    // Создание HTTPS приложения
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      httpsOptions,
    });
    // Serve Mini App static build
    const miniAppDist = path.join(process.cwd(), 'web', 'mini-app', 'dist');
    app.useStaticAssets(miniAppDist, { prefix: '/mini-app' });
    // Main static page assets
    const homePage = path.join(process.cwd(), 'web', 'home');
    app.useStaticAssets(homePage, { prefix: '/home' });
    // Static GPX → PNG tool (plain HTML/CSS/JS)
    const gpxRoutePng = path.join(process.cwd(), 'web', 'gpx-route-png');
    app.useStaticAssets(gpxRoutePng, { prefix: '/gpx-route-png' });
    const subsPage = path.join(process.cwd(), 'web', 'subs');
    app.useStaticAssets(subsPage, { prefix: '/subs' });
    // Fallback to index.html for SPA routes (use RegExp to avoid path-to-regexp issues)
    const instance = app.getHttpAdapter().getInstance();
    instance.get(/^\/mini-app(?:\/.*)?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(miniAppDist, 'index.html'));
    });
    instance.get(/^\/gpx-route-png\/?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(gpxRoutePng, 'index.html'));
    });
    instance.get(/^\/gpx-route-png\/en\/?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(gpxRoutePng, 'en.html'));
    });
    instance.get(/^\/subs\/?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(subsPage, 'index.html'));
    });
    await app.listen(443);
  } else {
    // Development mode - HTTP
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    // Serve Mini App static build in dev too (or use Vite dev server separately)
    const miniAppDist = path.join(process.cwd(), 'web', 'mini-app', 'dist');
    app.useStaticAssets(miniAppDist, { prefix: '/mini-app' });
    const homePage = path.join(process.cwd(), 'web', 'home');
    app.useStaticAssets(homePage, { prefix: '/home' });
    const gpxRoutePng = path.join(process.cwd(), 'web', 'gpx-route-png');
    app.useStaticAssets(gpxRoutePng, { prefix: '/gpx-route-png' });
    const subsPage = path.join(process.cwd(), 'web', 'subs');
    app.useStaticAssets(subsPage, { prefix: '/subs' });
    const instance = app.getHttpAdapter().getInstance();
    instance.get(/^\/mini-app(?:\/.*)?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(miniAppDist, 'index.html'));
    });
    instance.get(/^\/gpx-route-png\/?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(gpxRoutePng, 'index.html'));
    });
    instance.get(/^\/gpx-route-png\/en\/?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(gpxRoutePng, 'en.html'));
    });
    instance.get(/^\/subs\/?$/, (_req: unknown, res: Response) => {
      res.sendFile(path.join(subsPage, 'index.html'));
    });
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
  }
}

void bootstrap();
