import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  InternalServerErrorException,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { timingSafeEqual } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { Prisma } from './generated/prisma-client';
import { PrismaService } from './prisma/prisma.service';
import { LlmService } from './services/llm.service';
import { StorageService } from './services/storage.service';
import { TelegramBotService } from './telegram-bot/telegram-bot.service';

type UploadedImage = {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
};

type CreateNoteBody = {
  text?: string;
  date?: string;
};

const PRIMARY_CHAT_ID = 150847737;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

@Controller('notes-api')
export class NotesApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly telegramBotService: TelegramBotService,
  ) {}

  @Post('notes')
  @UseInterceptors(
    FileInterceptor('image', {
      dest: tmpdir(),
      limits: {
        fileSize: MAX_IMAGE_SIZE_BYTES,
      },
      fileFilter: (_req, file, callback) => {
        if (file.mimetype.startsWith('image/')) {
          callback(null, true);
          return;
        }

        callback(
          new BadRequestException('Only image files are supported'),
          false,
        );
      },
    }),
  )
  async createNote(
    @Headers('x-note-api-key') apiKey: string | undefined,
    @Body() body: CreateNoteBody,
    @UploadedFile() image?: UploadedImage,
  ) {
    this.assertApiKey(apiKey);

    if (!image) {
      throw new BadRequestException('Image is required');
    }

    const text = this.parseText(body.text);
    const noteDate = this.parseDate(body.date);

    try {
      const imageBuffer = await readFile(image.path);
      const imageUrl = await this.storageService.uploadFile(
        imageBuffer,
        image.mimetype,
        PRIMARY_CHAT_ID,
      );
      const imageDescription = await this.llmService.describeImage(
        imageBuffer,
        text,
      );

      const note = await this.prisma.note.create({
        data: {
          content: text,
          noteDate,
          chatId: PRIMARY_CHAT_ID,
          rawMessage: {
            source: 'notes-api',
            text,
            date: body.date,
            imageDescription,
            image: {
              originalName: image.originalname,
              mimeType: image.mimetype,
              size: image.size,
            },
          } satisfies Prisma.InputJsonValue,
          images: {
            create: {
              url: imageUrl,
              description: imageDescription,
            },
          },
        },
        include: {
          images: true,
        },
      });

      await this.telegramBotService.sendApiNotePhoto(
        PRIMARY_CHAT_ID,
        imageUrl,
        text,
        imageDescription,
        noteDate,
      );

      return {
        id: note.id,
        chatId: PRIMARY_CHAT_ID,
        text: note.content,
        date: note.noteDate.toISOString(),
        imageUrl: note.images[0]?.url,
        imageDescription,
      };
    } finally {
      await unlink(image.path).catch(() => undefined);
    }
  }

  private assertApiKey(receivedKey?: string): void {
    const expectedKey = this.configService.get<string>('NOTE_API_KEY');
    if (!expectedKey) {
      throw new InternalServerErrorException('NOTE_API_KEY is not configured');
    }

    if (!receivedKey || !this.isSameSecret(receivedKey, expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
  }

  private isSameSecret(receivedKey: string, expectedKey: string): boolean {
    const received = Buffer.from(receivedKey);
    const expected = Buffer.from(expectedKey);

    if (received.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(received, expected);
  }

  private parseText(text?: string): string {
    if (typeof text !== 'string') {
      throw new BadRequestException('Text is required');
    }

    return text.trim();
  }

  private parseDate(date?: string): Date {
    if (typeof date !== 'string') {
      throw new BadRequestException('Date is required');
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Date must be a valid date string');
    }

    return parsedDate;
  }
}
