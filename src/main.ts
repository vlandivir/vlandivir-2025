import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';

async function bootstrap() {
  console.log(process.env);

  let httpsOptions: HttpsOptions;
  
  try {
    httpsOptions = {
      key: fs.readFileSync(path.join(process.cwd(), '.secret', 'privkey.pem')),
      cert: fs.readFileSync(path.join(process.cwd(), '.secret', 'fullchain.pem')),
    };
  } catch (error) {
    console.error('Ошибка при чтении SSL сертификатов:', error);
    process.exit(1);
  }

  // Создание HTTPS приложения
  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });
  await app.listen(443); // Изменяем порт на 443 (стандартный HTTPS порт)
}

bootstrap();
