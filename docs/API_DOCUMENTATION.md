# API Documentation

## Overview

This document provides comprehensive documentation for the `vlandivir-2025` project, a NestJS application that serves as a Telegram bot for diary note management, task tracking, Q&A functionality, and image processing.

## Architecture

The application follows a modular architecture with the following main components:

- **Core Services**: Database, storage, LLM integration, date parsing
- **Telegram Bot Services**: Command handlers for different bot functionalities
- **HTTP Controllers**: REST API endpoints and webhook handlers
- **Database Models**: Prisma-based data models

## Table of Contents

1. [HTTP API Endpoints](#http-api-endpoints)
2. [Core Services](#core-services)
3. [Telegram Bot Commands](#telegram-bot-commands)
4. [Database Models](#database-models)
5. [Utility Scripts](#utility-scripts)

---

## HTTP API Endpoints

### AppController

Base controller for the application.

#### GET /

Returns a simple greeting message.

**Response:**
```typescript
string // "Hello World!"
```

**Example:**
```bash
curl http://localhost:3000/
```

### TelegramBotController

Handles Telegram webhook updates.

#### POST /telegram-bot

Processes incoming Telegram webhook updates.

**Request Body:**
```typescript
interface Update {
  message?: Message;
  callback_query?: CallbackQuery;
  channel_post?: Message;
  // ... other Telegram update types
}
```

**Response:**
```typescript
void
```

**Example:**
```bash
curl -X POST http://localhost:3000/telegram-bot \
  -H "Content-Type: application/json" \
  -d '{"message": {...}}'
```

---

## Core Services

### PrismaService

Database service extending PrismaClient for database operations.

#### Methods

##### onModuleInit(): Promise<void>

Connects to the database when the module initializes.

##### onModuleDestroy(): Promise<void>

Disconnects from the database when the module is destroyed.

**Usage:**
```typescript
constructor(private readonly prisma: PrismaService) {}

// Use prisma client methods
const notes = await this.prisma.note.findMany();
```

### StorageService

Service for file storage operations using DigitalOcean Spaces (S3-compatible).

#### Configuration

Requires environment variables:
- `DO_SPACES_ACCESS_KEY`: DigitalOcean Spaces access key
- `DO_SPACES_SECRET_KEY`: DigitalOcean Spaces secret key

#### Methods

##### uploadFile(buffer: Buffer, mimeType: string, chatId: number): Promise<string>

Uploads a file buffer to the storage bucket.

**Parameters:**
- `buffer`: File content as Buffer
- `mimeType`: MIME type of the file
- `chatId`: Chat ID for organizing files

**Returns:** URL of the uploaded file

**Example:**
```typescript
const url = await storageService.uploadFile(
  imageBuffer, 
  'image/jpeg', 
  123456789
);
```

##### uploadFileWithKey(buffer: Buffer, mimeType: string, key: string): Promise<string>

Uploads a file with a specific key/path.

**Parameters:**
- `buffer`: File content as Buffer
- `mimeType`: MIME type of the file
- `key`: Custom key/path for the file

**Returns:** URL of the uploaded file

##### downloadFile(url: string): Promise<Buffer>

Downloads a file from the storage bucket.

**Parameters:**
- `url`: URL of the file to download

**Returns:** File content as Buffer

### LlmService

Service for Large Language Model operations using OpenAI API.

#### Configuration

Requires environment variables:
- `OPENAI_API_KEY`: OpenAI API key

#### Methods

##### describeImage(imageBuffer: Buffer): Promise<string>

Generates a Russian description of an image using GPT-4V.

**Parameters:**
- `imageBuffer`: Image content as Buffer

**Returns:** Russian text description of the image

**Example:**
```typescript
const description = await llmService.describeImage(imageBuffer);
// Returns: "На изображении показан красивый закат над океаном..."
```

### DateParserService

Service for parsing various date formats from text.

#### Methods

##### extractDateFromFirstLine(text: string): ParseResult

Extracts date from the first line of text and returns cleaned content.

**Parameters:**
- `text`: Input text potentially containing a date

**Returns:**
```typescript
interface ParseResult {
  date: Date | null;    // Parsed date or null if not found
  cleanContent: string; // Text with date line removed
}
```

**Supported Formats:**
- `YYYY.MM.DD` or `YYYY-MM-DD`
- `DD.MM` or `MM/DD` (year defaults to current)
- `DD MMMM` (Russian month names, e.g., `2 января`)
- `DD MMM YYYY` (English month names, e.g., `2 Jan 2025`)

**Example:**
```typescript
const result = dateParser.extractDateFromFirstLine("02.01.2025\nMy note text");
// result.date: Date object for Jan 2, 2025
// result.cleanContent: "My note text"
```

---

## Telegram Bot Commands

### TelegramBotService

Main service orchestrating the Telegram bot functionality.

#### Configuration

Requires environment variables:
- `TELEGRAM_BOT_TOKEN`: Telegram bot token
- `VLANDIVIR_2025_WEBHOOK_URL`: Webhook URL for receiving updates

#### Methods

##### handleWebhook(update: Update): Promise<void>

Processes incoming Telegram webhook updates.

##### handleIncomingMessage(ctx: Context, content: string, noteDate?: Date): Promise<void>

Processes incoming text messages and saves them as diary notes.

##### handleIncomingPhoto(ctx: Context, silent?: boolean): Promise<void>

Processes incoming photos, uploads them to storage, and generates descriptions.

### DairyCommandsService

Handles diary-related commands.

#### Commands

##### /d or /dairy [date]

Retrieves diary entries for a specific date.

**Parameters:**
- `date` (optional): Date in supported formats

**Examples:**
```
/d                    # Shows today's notes from all years
/d 25.03.2024        # Shows notes for March 25, 2024
/d 25.03             # Shows March 25 notes from all years
```

#### Methods

##### handleDairyCommand(ctx: Context): Promise<void>

Processes the dairy command and sends appropriate responses.

### TaskCommandsService

Handles task management commands.

#### Commands

##### /t or /task [key] [content] [modifiers]

Creates or updates a task.

**Modifiers:**
- `@tag`: Add tags
- `.context`: Specify contexts
- `!project`: Assign projects
- `(A)`: Set priority (A-Z)
- `:date [time]`: Set due date
- `-status`: Update status (done, canceled, in-progress, started, snoozed[days])

**Examples:**
```
/task (B) @work .office !Big Project :2025.07.31 09:00 Prepare report
/t T-20250710-03 -done
/t @urgent Fix bug in production
```

##### /tl [filters]

Lists unfinished tasks with optional filters.

**Examples:**
```
/tl                  # All unfinished tasks
/tl @work .office    # Tasks with work tag and office context
```

#### Methods

##### handleTaskCommand(ctx: Context): Promise<void>

Processes task creation and update commands.

##### handleListCommand(ctx: Context): Promise<void>

Processes task listing commands.

### TaskHistoryCommandsService

Handles task history visualization.

#### Commands

##### /th

Generates an HTML page with all tasks and their history.

**Features:**
- Organizes tasks into Unfinished, Snoozed, and Finished categories
- Shows task history with changes
- Uploads to DigitalOcean Spaces with secure URL

#### Methods

##### handleTaskHistoryCommand(ctx: Context): Promise<void>

Generates and uploads task history HTML page.

### QaCommandsService

Handles question and answer functionality.

#### Commands

##### /qa

Starts interactive flow to add a question.

**Flow:**
1. Send question text
2. Choose type (string, number, boolean) via inline buttons

##### /ql

Lists all questions for the current chat.

##### /qq [date]

Shows questions with answers for a specific date (or today).

##### /q

Shows the next unanswered question for today.

##### /qh

Generates HTML page with question history.

#### Methods

##### handleQaCommand(ctx: Context): Promise<void>

Starts question creation flow.

##### handleQlCommand(ctx: Context): Promise<void>

Lists all questions.

##### handleQqCommand(ctx: Context): Promise<void>

Shows questions and answers for a date.

##### handleQCommand(ctx: Context): Promise<void>

Shows next unanswered question.

##### handleQhCommand(ctx: Context): Promise<void>

Generates question history HTML.

### CollageCommandsService

Handles image collage creation.

#### Commands

##### /collage

Starts interactive collage creation flow.

**Flow:**
1. Send first image
2. Continue adding images (minimum 3)
3. Generate collage

#### Methods

##### startConversation(ctx: Context): Promise<void>

Starts collage creation session.

##### addImage(ctx: Context): Promise<void>

Adds image to current collage session.

##### generate(ctx: Context): Promise<void>

Creates and sends the final collage.

##### cancel(ctx: Context): Promise<void>

Cancels current collage session.

### HistoryCommandsService

Handles chat history export.

#### Commands

##### /history

Generates HTML page with all messages longer than 21 characters.

**Features:**
- Filters meaningful messages
- Includes message dates and images
- Generates secure GUID-based link
- Beautiful HTML formatting

#### Methods

##### handleHistoryCommand(ctx: Context): Promise<void>

Generates and uploads chat history HTML page.

### SerbianCommandsService

Handles Serbian language translations.

#### Commands

##### /s [text]

Provides Serbian translations (private chats only).

**Example:**
```
/s zdravo
# Returns translation and pronunciation
```

#### Methods

##### handleSerbianCommand(ctx: Context): Promise<void>

Processes Serbian translation requests.

---

## Database Models

### Note

Stores diary notes and messages.

```typescript
interface Note {
  id: number;
  content: string;
  rawMessage: object;    // Original Telegram message
  noteDate: Date;        // Date for the note content
  createdAt: Date;
  updatedAt?: Date;
  chatId: bigint;
  images: Image[];       // Related images
}
```

### Image

Stores image metadata and descriptions.

```typescript
interface Image {
  id: number;
  url: string;           // Storage URL
  description?: string;  // AI-generated description
  noteId: number;        // Related note
  createdAt: Date;
  updatedAt: Date;
}
```

### Todo

Stores task information.

```typescript
interface Todo {
  id: number;
  key: string;           // Unique key (T-YYYYMMDD-XX)
  content: string;       // Task description
  status: string;        // new, in-progress, done, canceled, snoozed
  priority?: string;     // A-Z priority
  dueDate?: Date;
  snoozedUntil?: Date;
  tags: string[];        // @tag
  contexts: string[];    // .context
  projects: string[];    // !project
  chatId?: bigint;
  createdAt: Date;
  completedAt?: Date;
}
```

### Question

Stores questions for Q&A system.

```typescript
interface Question {
  id: number;
  chatId: bigint;
  questionText: string;
  type: string;          // "text", "number", "binary"
  createdAt: Date;
  answers: Answer[];
}
```

### Answer

Stores answers to questions.

```typescript
interface Answer {
  id: number;
  questionId: number;
  textAnswer?: string;
  numberAnswer?: number;
  answerDate: Date;      // Date the answer is for
  createdAt: Date;
  question: Question;
}
```

### BotResponse

Stores bot responses for tracking.

```typescript
interface BotResponse {
  id: number;
  content: string;
  noteId: number;
  chatId: bigint;
  createdAt: Date;
  updatedAt?: Date;
}
```

---

## Utility Scripts

### update-image-descriptions.ts

Updates AI descriptions for existing images.

**Usage:**
```bash
npm run update-image-descriptions
```

**Features:**
- Processes images without descriptions
- Uses LLM service for description generation
- Configurable limit via --limit parameter

### check-image-status.ts

Checks the status of images in the database.

**Usage:**
```bash
npm run check-image-status
```

**Features:**
- Reports total images
- Shows count with/without descriptions
- Displays statistics

### test-collage-custom.ts

Testing utility for collage creation functionality.

**Usage:**
```bash
npm run test-collage
```

**Features:**
- Tests collage creation with sample images
- Validates image processing pipeline
- Outputs result to file system

---

## Environment Variables

### Required Configuration

```env
# Database
POSTGRES_CONNECTION_STRING=postgresql://...

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
VLANDIVIR_2025_WEBHOOK_URL=https://your-domain.com/telegram-bot

# Storage
DO_SPACES_ACCESS_KEY=your_access_key
DO_SPACES_SECRET_KEY=your_secret_key

# AI Services
OPENAI_API_KEY=your_openai_key

# Application
ENVIRONMENT=DEV|PROD
PORT=3000
```

## Development Setup

### Installation

```bash
npm install
```

### Database Setup

```bash
npx prisma migrate dev
npx prisma generate
```

### Running the Application

```bash
# Development
npm run start:dev

# Production
npm run start:prod

# Testing
npm run test
npm run test:e2e
```

### Code Quality

```bash
# Linting
npm run lint

# Formatting
npm run format

# Type checking
npx tsc --noEmit
```

## Error Handling

All services implement comprehensive error handling:

- Database connection errors are logged and re-thrown
- External API failures return graceful error messages
- File upload/download errors include detailed error context
- Invalid user input is validated and rejected with helpful messages

## Security Considerations

- All uploaded files are stored with ACL: 'public-read'
- History and task HTML pages use GUID-based URLs for security
- Webhook endpoint validates Telegram update structure
- Database queries use Prisma's built-in SQL injection protection

## Performance Considerations

- Images are processed asynchronously
- Database queries use appropriate indexes
- Large file operations are streamed where possible
- Bot responses are optimized for minimal API calls

## Monitoring and Logging

- All major operations are logged to console
- Error conditions include detailed context
- Database operations are automatically logged by Prisma
- Webhook updates are logged with full context