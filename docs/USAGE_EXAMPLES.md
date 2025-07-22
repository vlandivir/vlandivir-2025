# Usage Examples and Code Samples

This document provides comprehensive usage examples and code samples for all APIs, services, and components in the vlandivir-2025 project.

## Table of Contents

1. [HTTP API Usage](#http-api-usage)
2. [Core Services Usage](#core-services-usage)
3. [Telegram Bot Commands](#telegram-bot-commands)
4. [Database Operations](#database-operations)
5. [Testing Examples](#testing-examples)
6. [Integration Examples](#integration-examples)
7. [Error Handling Examples](#error-handling-examples)

---

## HTTP API Usage

### Basic Health Check

```typescript
// GET /
const response = await fetch('http://localhost:3000/');
const message = await response.text();
console.log(message); // "Hello World!"
```

### Webhook Integration

```typescript
// Telegram webhook setup
const webhookUrl = 'https://your-domain.com/telegram-bot';

// Setting up webhook (typically done once)
const botToken = process.env.TELEGRAM_BOT_TOKEN;
await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl })
});

// Webhook endpoint usage
const update = {
  update_id: 123456,
  message: {
    message_id: 1,
    from: { id: 123456789, first_name: 'John' },
    chat: { id: 123456789, type: 'private' },
    date: Math.floor(Date.now() / 1000),
    text: '/help'
  }
};

const response = await fetch('http://localhost:3000/telegram-bot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(update)
});
```

---

## Core Services Usage

### StorageService Examples

```typescript
import { StorageService } from '../services/storage.service';

// Dependency injection in NestJS service
@Injectable()
export class ExampleService {
  constructor(private readonly storageService: StorageService) {}

  async uploadImage(imageBuffer: Buffer, chatId: number): Promise<string> {
    try {
      const url = await this.storageService.uploadFile(
        imageBuffer,
        'image/jpeg',
        chatId
      );
      console.log('Image uploaded:', url);
      return url;
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  }

  async uploadWithCustomPath(buffer: Buffer, filename: string): Promise<string> {
    const key = `custom/${filename}`;
    return await this.storageService.uploadFileWithKey(
      buffer,
      'application/octet-stream',
      key
    );
  }

  async downloadAndProcessImage(imageUrl: string): Promise<Buffer> {
    const imageBuffer = await this.storageService.downloadFile(imageUrl);
    
    // Process the image (e.g., resize, compress)
    const processedBuffer = await this.processImage(imageBuffer);
    
    return processedBuffer;
  }

  private async processImage(buffer: Buffer): Promise<Buffer> {
    // Image processing logic
    return buffer;
  }
}
```

### LlmService Examples

```typescript
import { LlmService } from '../services/llm.service';

@Injectable()
export class ImageProcessingService {
  constructor(private readonly llmService: LlmService) {}

  async analyzeImage(imageBuffer: Buffer): Promise<string> {
    try {
      const description = await this.llmService.describeImage(imageBuffer);
      console.log('Generated description:', description);
      return description;
    } catch (error) {
      console.error('Image analysis failed:', error);
      return 'Не удалось проанализировать изображение';
    }
  }

  async batchProcessImages(imageBuffers: Buffer[]): Promise<string[]> {
    const descriptions = await Promise.allSettled(
      imageBuffers.map(buffer => this.llmService.describeImage(buffer))
    );

    return descriptions.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`Failed to process image ${index}:`, result.reason);
        return `Ошибка обработки изображения ${index + 1}`;
      }
    });
  }
}
```

### DateParserService Examples

```typescript
import { DateParserService } from '../services/date-parser.service';

@Injectable()
export class NoteService {
  constructor(private readonly dateParser: DateParserService) {}

  async createNoteFromMessage(messageText: string): Promise<void> {
    // Parse date from message
    const { date, cleanContent } = this.dateParser.extractDateFromFirstLine(messageText);
    
    const noteDate = date || new Date(); // Use today if no date found
    
    console.log('Note date:', noteDate);
    console.log('Note content:', cleanContent);

    // Save to database
    await this.saveNote(cleanContent, noteDate);
  }

  private examples() {
    // Example inputs and their parsed results
    const examples = [
      '02.01.2025\nMy diary entry',     // Date: Jan 2, 2025, Content: "My diary entry"
      '25.12\nChristmas celebration',   // Date: Dec 25, current year, Content: "Christmas celebration"
      '15 января\nЗимний день',         // Date: Jan 15, current year, Content: "Зимний день"
      'Just a regular note',            // Date: null, Content: "Just a regular note"
      '2025-03-15 14:30\nMeeting notes' // Date: Mar 15, 2025, Content: "Meeting notes"
    ];

    examples.forEach(text => {
      const result = this.dateParser.extractDateFromFirstLine(text);
      console.log(`Input: "${text}"`);
      console.log(`Date: ${result.date}`);
      console.log(`Content: "${result.cleanContent}"`);
      console.log('---');
    });
  }

  private async saveNote(content: string, date: Date): Promise<void> {
    // Database save logic
  }
}
```

---

## Telegram Bot Commands

### Diary Commands Examples

```typescript
// User sends: "/d 25.03.2024"
// Bot response: Shows diary entries for March 25, 2024

// User sends: "/d 25.03"
// Bot response: Shows March 25 entries from all years

// User sends: "/d"
// Bot response: Shows today's entries from all years

// Creating a note with date
// User sends: "02.01.2025\nToday I learned something new"
// Bot saves note for January 2, 2025 with content "Today I learned something new"

// Creating a note without date
// User sends: "Just had a great coffee"
// Bot saves note for today with the full content
```

### Task Management Examples

```typescript
// Creating tasks
// User sends: "/task (A) @urgent .work !Project Alpha :2025.01.15 Fix critical bug"
// Creates task with:
// - Priority: A
// - Tag: urgent
// - Context: work
// - Project: Project Alpha
// - Due date: January 15, 2025
// - Content: "Fix critical bug"

// User sends: "/t @personal .home Buy groceries"
// Creates task with tag "personal", context "home"

// Updating existing tasks
// User sends: "/t T-20250101-01 -done"
// Marks task T-20250101-01 as done

// User sends: "/t T-20250101-02 @urgent .office"
// Adds urgent tag and office context to existing task

// Snoozing tasks
// User sends: "/t T-20250101-03 -snoozed7"
// Snoozes task for 7 days

// Listing tasks
// User sends: "/tl"
// Shows all unfinished tasks

// User sends: "/tl @urgent"
// Shows only urgent tasks

// User sends: "/tl .work !Project Alpha"
// Shows work context tasks in Project Alpha
```

### Question & Answer Examples

```typescript
// Creating questions
// User sends: "/qa"
// Bot: "Отправьте текст вопроса:"
// User: "How much water did you drink today?"
// Bot shows type selection buttons (String/Number/Boolean)
// User clicks "Number"
// Question is created

// Answering questions
// User sends: "/q"
// Bot: "How much water did you drink today? (Число)"
// User: "2.5"
// Answer recorded for today

// Viewing questions and answers
// User sends: "/qq"
// Shows today's questions with answers

// User sends: "/qq 01.01.2025"
// Shows questions and answers for January 1, 2025

// Listing all questions
// User sends: "/ql"
// Shows all questions for the chat
```

### Collage Creation Examples

```typescript
// Starting collage creation
// User sends: "/collage"
// Bot: "Отправьте изображение 1" with Cancel button

// Adding images
// User sends photo 1
// Bot: "Изображение 1 добавлено" with Cancel button

// User sends photo 2
// Bot: "Изображение 2 добавлено" with Cancel button

// User sends photo 3
// Bot: "Изображение 3 добавлено" with Cancel and Generate buttons

// User clicks "Generate"
// Bot creates and sends collage image
```

---

## Database Operations

### Prisma Service Usage

```typescript
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DatabaseExamples {
  constructor(private readonly prisma: PrismaService) {}

  // Creating a note with images
  async createNoteWithImages(
    content: string,
    chatId: bigint,
    imageUrls: string[]
  ): Promise<Note> {
    return await this.prisma.note.create({
      data: {
        content,
        chatId,
        noteDate: new Date(),
        rawMessage: {},
        images: {
          create: imageUrls.map(url => ({
            url,
            description: null
          }))
        }
      },
      include: {
        images: true
      }
    });
  }

  // Finding notes by date range
  async getNotesByDateRange(
    chatId: bigint,
    startDate: Date,
    endDate: Date
  ): Promise<Note[]> {
    return await this.prisma.note.findMany({
      where: {
        chatId,
        noteDate: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        images: true
      },
      orderBy: {
        noteDate: 'desc'
      }
    });
  }

  // Complex task query
  async getFilteredTasks(
    chatId: bigint,
    filters: {
      tags?: string[];
      contexts?: string[];
      projects?: string[];
      status?: string[];
    }
  ): Promise<Todo[]> {
    const where: any = { chatId };

    if (filters.tags?.length) {
      where.tags = { hasSome: filters.tags };
    }
    if (filters.contexts?.length) {
      where.contexts = { hasSome: filters.contexts };
    }
    if (filters.projects?.length) {
      where.projects = { hasSome: filters.projects };
    }
    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    return await this.prisma.todo.findMany({
      where,
      orderBy: [
        { dueDate: 'asc' },
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });
  }

  // Question with answers aggregation
  async getQuestionsWithAnswersForDate(
    chatId: bigint,
    date: Date
  ): Promise<any[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await this.prisma.question.findMany({
      where: { chatId },
      include: {
        Answer: {
          where: {
            answerDate: {
              gte: startOfDay,
              lte: endOfDay
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  // Batch operations
  async batchUpdateImageDescriptions(
    updates: Array<{ id: number; description: string }>
  ): Promise<void> {
    await this.prisma.$transaction(
      updates.map(update =>
        this.prisma.image.update({
          where: { id: update.id },
          data: { description: update.description }
        })
      )
    );
  }
}
```

---

## Testing Examples

### Unit Test Examples

```typescript
// storage.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                'DO_SPACES_ACCESS_KEY': 'test-access-key',
                'DO_SPACES_SECRET_KEY': 'test-secret-key'
              };
              return config[key];
            })
          }
        }
      ]
    }).compile();

    service = module.get<StorageService>(StorageService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should upload file successfully', async () => {
    const buffer = Buffer.from('test file content');
    const mimeType = 'text/plain';
    const chatId = 123456;

    // Mock S3 upload
    const mockUpload = {
      done: jest.fn().mockResolvedValue({ Location: 'https://test.com/file.txt' })
    };
    
    jest.spyOn(service as any, 'uploadFile').mockResolvedValue('https://test.com/file.txt');

    const result = await service.uploadFile(buffer, mimeType, chatId);
    
    expect(result).toBe('https://test.com/file.txt');
  });
});

// date-parser.service.spec.ts
import { DateParserService } from './date-parser.service';

describe('DateParserService', () => {
  let service: DateParserService;

  beforeEach(() => {
    service = new DateParserService();
  });

  describe('extractDateFromFirstLine', () => {
    it('should parse DD.MM.YYYY format', () => {
      const input = '02.01.2025\nTest content';
      const result = service.extractDateFromFirstLine(input);
      
      expect(result.date).toEqual(new Date(2025, 0, 2)); // January 2, 2025
      expect(result.cleanContent).toBe('Test content');
    });

    it('should parse DD.MM format with current year', () => {
      const input = '25.12\nChristmas note';
      const result = service.extractDateFromFirstLine(input);
      
      expect(result.date?.getMonth()).toBe(11); // December
      expect(result.date?.getDate()).toBe(25);
      expect(result.date?.getFullYear()).toBe(new Date().getFullYear());
      expect(result.cleanContent).toBe('Christmas note');
    });

    it('should return null date for invalid format', () => {
      const input = 'No date here\nJust content';
      const result = service.extractDateFromFirstLine(input);
      
      expect(result.date).toBeNull();
      expect(result.cleanContent).toBe(input);
    });

    it('should handle empty input', () => {
      const result = service.extractDateFromFirstLine('');
      
      expect(result.date).toBeNull();
      expect(result.cleanContent).toBe('');
    });
  });
});
```

### Integration Test Examples

```typescript
// telegram-bot.controller.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('TelegramBotController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/telegram-bot (POST) - should handle message update', () => {
    const update = {
      update_id: 123456,
      message: {
        message_id: 1,
        from: { id: 123456789, first_name: 'Test' },
        chat: { id: 123456789, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/help'
      }
    };

    return request(app.getHttpServer())
      .post('/telegram-bot')
      .send(update)
      .expect(201);
  });

  it('/telegram-bot (POST) - should handle callback query', () => {
    const update = {
      update_id: 123457,
      callback_query: {
        id: 'callback123',
        from: { id: 123456789, first_name: 'Test' },
        data: 'qa_type_number'
      }
    };

    return request(app.getHttpServer())
      .post('/telegram-bot')
      .send(update)
      .expect(201);
  });
});
```

---

## Integration Examples

### Custom Service Integration

```typescript
// Creating a custom service that uses multiple core services
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly llmService: LlmService,
    private readonly dateParser: DateParserService
  ) {}

  async generateMonthlyReport(chatId: bigint, month: number, year: number): Promise<string> {
    // Get date range for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // Fetch all notes for the month
    const notes = await this.prisma.note.findMany({
      where: {
        chatId,
        noteDate: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        images: true
      },
      orderBy: {
        noteDate: 'asc'
      }
    });

    // Fetch all tasks for the month
    const tasks = await this.prisma.todo.findMany({
      where: {
        chatId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Generate HTML report
    const html = await this.generateReportHTML(notes, tasks, month, year);

    // Upload to storage
    const buffer = Buffer.from(html, 'utf-8');
    const filename = `report-${year}-${month.toString().padStart(2, '0')}.html`;
    const url = await this.storageService.uploadFileWithKey(
      buffer,
      'text/html',
      `reports/${chatId}/${filename}`
    );

    return url;
  }

  private async generateReportHTML(
    notes: Note[],
    tasks: Todo[],
    month: number,
    year: number
  ): Promise<string> {
    const monthNames = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Отчет за ${monthNames[month - 1]} ${year}</title>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .note { margin-bottom: 20px; padding: 10px; border-left: 3px solid #007bff; }
          .task { margin-bottom: 10px; padding: 8px; background: #f8f9fa; }
          .date { font-weight: bold; color: #666; }
          .completed { text-decoration: line-through; opacity: 0.7; }
        </style>
      </head>
      <body>
        <h1>Отчет за ${monthNames[month - 1]} ${year}</h1>
        
        <h2>Записи дневника (${notes.length})</h2>
        ${notes.map(note => `
          <div class="note">
            <div class="date">${note.noteDate.toLocaleDateString('ru-RU')}</div>
            <div>${note.content}</div>
            ${note.images?.length ? `<div>Изображений: ${note.images.length}</div>` : ''}
          </div>
        `).join('')}
        
        <h2>Задачи (${tasks.length})</h2>
        ${tasks.map(task => `
          <div class="task ${task.status === 'done' ? 'completed' : ''}">
            <strong>${task.key}</strong>: ${task.content}
            <div>Статус: ${task.status}</div>
            ${task.tags.length ? `<div>Теги: ${task.tags.join(', ')}</div>` : ''}
          </div>
        `).join('')}
      </body>
      </html>
    `;
  }
}
```

### Webhook Handler Extension

```typescript
// Custom webhook handler for additional functionality
@Injectable()
export class ExtendedWebhookHandler {
  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly analyticsService: AnalyticsService
  ) {}

  async handleUpdate(update: Update): Promise<void> {
    // Log analytics
    await this.analyticsService.logUpdate(update);

    // Rate limiting check
    if (await this.isRateLimited(update)) {
      return;
    }

    // Custom preprocessing
    const processedUpdate = await this.preprocessUpdate(update);

    // Hand off to main bot service
    await this.telegramBotService.handleWebhook(processedUpdate);

    // Post-processing
    await this.postprocessUpdate(update);
  }

  private async isRateLimited(update: Update): Promise<boolean> {
    const userId = this.extractUserId(update);
    if (!userId) return false;

    // Implement rate limiting logic
    return false;
  }

  private async preprocessUpdate(update: Update): Promise<Update> {
    // Add custom fields, validation, etc.
    return update;
  }

  private async postprocessUpdate(update: Update): Promise<void> {
    // Analytics, logging, etc.
  }

  private extractUserId(update: Update): number | null {
    if ('message' in update && update.message?.from) {
      return update.message.from.id;
    }
    if ('callback_query' in update && update.callback_query?.from) {
      return update.callback_query.from.id;
    }
    return null;
  }
}
```

---

## Error Handling Examples

### Service Error Handling

```typescript
@Injectable()
export class RobustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly logger: Logger
  ) {}

  async processImageWithRetry(imageBuffer: Buffer, maxRetries = 3): Promise<string> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Try to upload image
        const url = await this.storageService.uploadFile(
          imageBuffer,
          'image/jpeg',
          Date.now()
        );

        this.logger.log(`Image uploaded successfully on attempt ${attempt}: ${url}`);
        return url;

      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Upload attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    this.logger.error(`Failed to upload image after ${maxRetries} attempts: ${lastError.message}`);
    throw new Error(`Upload failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  async safelyProcessMessage(ctx: Context): Promise<void> {
    try {
      await this.processMessage(ctx);
    } catch (error) {
      this.logger.error('Error processing message:', error);

      // Send user-friendly error message
      if (error instanceof ValidationError) {
        await ctx.reply(`Ошибка в данных: ${error.message}`);
      } else if (error instanceof DatabaseError) {
        await ctx.reply('Временная ошибка базы данных. Попробуйте позже.');
      } else if (error instanceof ExternalAPIError) {
        await ctx.reply('Ошибка внешнего сервиса. Попробуйте позже.');
      } else {
        await ctx.reply('Произошла неожиданная ошибка. Попробуйте позже.');
      }
    }
  }

  private async processMessage(ctx: Context): Promise<void> {
    // Message processing logic
  }
}

// Custom error classes
export class ValidationError extends Error {
  constructor(message: string, public field: string, public value: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string, public originalError: Error) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ExternalAPIError extends Error {
  constructor(
    message: string,
    public apiName: string,
    public statusCode: number,
    public response?: any
  ) {
    super(message);
    this.name = 'ExternalAPIError';
  }
}
```

### Global Exception Filter

```typescript
// global-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    }

    // Log the error
    this.logger.error(
      `HTTP ${status} Error: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
      `${request.method} ${request.url}`
    );

    // Send response
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: message,
    });
  }
}

// Usage in main.ts
import { GlobalExceptionFilter } from './global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(3000);
}
```

This comprehensive documentation provides practical examples for all major components and use cases in the vlandivir-2025 project. Developers can use these examples as starting points for implementing their own features or understanding how the existing system works.