import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
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
    const app = await NestFactory.create(AppModule, {
      httpsOptions,
    });
    await app.listen(443);
  } else {
    // Development mode - HTTP
    const app = await NestFactory.create(AppModule);
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
  }
}

bootstrap();
