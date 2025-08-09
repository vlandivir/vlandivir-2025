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
    app.useStaticAssets(path.join(process.cwd(), 'web', 'mini-app', 'dist'), {
      prefix: '/mini-app',
    });
    // Fallback to index.html for SPA routes
    const instance = app.getHttpAdapter().getInstance();
    instance.get('/mini-app/*', (_req: unknown, res: Response) => {
      res.sendFile(
        path.join(process.cwd(), 'web', 'mini-app', 'dist', 'index.html'),
      );
    });
    await app.listen(443);
  } else {
    // Development mode - HTTP
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    // Serve Mini App static build in dev too (or use Vite dev server separately)
    app.useStaticAssets(path.join(process.cwd(), 'web', 'mini-app', 'dist'), {
      prefix: '/mini-app',
    });
    const instance = app.getHttpAdapter().getInstance();
    instance.get('/mini-app/*', (_req: unknown, res: Response) => {
      res.sendFile(
        path.join(process.cwd(), 'web', 'mini-app', 'dist', 'index.html'),
      );
    });
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
  }
}

void bootstrap();
