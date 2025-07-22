# Documentation Index

Welcome to the comprehensive documentation for the `vlandivir-2025` project. This directory contains complete documentation for all public APIs, functions, components, and usage patterns.

## 📚 Documentation Structure

This documentation is organized into several focused documents:

### [📖 API Documentation](./API_DOCUMENTATION.md)
**Comprehensive API reference for all services and endpoints**
- HTTP API endpoints and controllers
- Core service methods and interfaces
- Telegram bot command handlers
- Database models and operations
- Utility scripts and tools
- Configuration and environment setup
- Error handling and security considerations

### [🔧 TypeScript Type Definitions](./TYPE_DEFINITIONS.md)
**Complete type definitions and interfaces**
- Core service interfaces
- Telegram bot types and contexts
- Database model types
- Configuration and environment types
- Utility types and type guards
- Generic utility types for common patterns

### [💡 Usage Examples and Code Samples](./USAGE_EXAMPLES.md)
**Practical examples and implementation patterns**
- HTTP API usage examples
- Service integration patterns
- Telegram bot command examples
- Database operation samples
- Testing examples (unit and integration)
- Error handling patterns
- Custom service implementations

## 🚀 Quick Start

### For Developers
1. **New to the project?** Start with [API Documentation](./API_DOCUMENTATION.md#overview) for a high-level overview
2. **Building features?** Check [Usage Examples](./USAGE_EXAMPLES.md) for implementation patterns
3. **Working with types?** Reference [Type Definitions](./TYPE_DEFINITIONS.md) for complete type information

### For API Users
1. **HTTP API?** See [HTTP API Endpoints](./API_DOCUMENTATION.md#http-api-endpoints)
2. **Telegram Bot?** Check [Telegram Bot Commands](./API_DOCUMENTATION.md#telegram-bot-commands)
3. **Database operations?** Reference [Database Models](./API_DOCUMENTATION.md#database-models)

## 🏗️ Project Architecture

The `vlandivir-2025` project is a NestJS application that serves as a Telegram bot with the following key features:

- **Diary Management**: Personal note-taking with date parsing and image support
- **Task Management**: GTD-style task tracking with tags, contexts, and projects
- **Q&A System**: Interactive question and answer functionality
- **Image Processing**: AI-powered image description and collage creation
- **History Export**: HTML export of chat history and task lists
- **Storage Integration**: DigitalOcean Spaces for file storage

### Core Technologies
- **Backend**: NestJS, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Storage**: DigitalOcean Spaces (S3-compatible)
- **AI Services**: OpenAI GPT-4V for image description
- **Bot Framework**: Telegraf for Telegram bot integration
- **Image Processing**: Sharp for image manipulation

## 📋 Available Commands

### Telegram Bot Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/d`, `/dairy` | View diary entries for a date | `/d 25.03.2024` |
| `/t`, `/task` | Create or update tasks | `/task (A) @urgent Fix bug` |
| `/tl` | List unfinished tasks | `/tl @work .office` |
| `/th` | Generate task history HTML | `/th` |
| `/qa` | Start Q&A creation flow | `/qa` |
| `/ql` | List all questions | `/ql` |
| `/qq` | View Q&A for a date | `/qq 01.01.2025` |
| `/q` | Show next unanswered question | `/q` |
| `/qh` | Generate Q&A history HTML | `/qh` |
| `/collage` | Create image collage | `/collage` |
| `/history` | Export chat history | `/history` |
| `/s` | Serbian translation | `/s zdravo` |
| `/help` | Show help message | `/help` |

### Development Commands

```bash
# Development
npm run start:dev          # Start in development mode
npm run start:debug        # Start with debugging
npm run start:prod         # Start in production mode

# Database
npx prisma migrate dev     # Run database migrations
npx prisma generate        # Generate Prisma client
npx prisma studio          # Open Prisma studio

# Testing
npm run test              # Run unit tests
npm run test:e2e          # Run integration tests
npm run test:cov          # Run tests with coverage

# Code Quality
npm run lint              # Lint code
npm run format            # Format code

# Utility Scripts
npm run update-image-descriptions  # Update AI descriptions
npm run check-image-status         # Check image statistics
npm run test-collage               # Test collage functionality
```

## 🔧 Configuration

### Required Environment Variables

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

See [Environment Variables](./API_DOCUMENTATION.md#environment-variables) for detailed configuration information.

## 🧪 Testing

The project includes comprehensive testing:

- **Unit Tests**: Individual service and component testing
- **Integration Tests**: End-to-end API testing
- **Type Testing**: TypeScript type safety validation

Example test execution:
```bash
npm run test                    # All unit tests
npm run test:watch             # Watch mode for development
npm run test:e2e              # Integration tests
npm run test:cov              # Coverage report
```

See [Testing Examples](./USAGE_EXAMPLES.md#testing-examples) for detailed testing patterns.

## 🛡️ Security & Performance

### Security Features
- **Input Validation**: All user inputs are validated and sanitized
- **SQL Injection Protection**: Prisma ORM provides built-in protection
- **Secure File Storage**: Files stored with appropriate ACL settings
- **Webhook Validation**: Telegram webhook updates are validated

### Performance Optimizations
- **Database Indexing**: Appropriate indexes on frequently queried fields
- **Async Processing**: Image processing and external API calls are asynchronous
- **Connection Pooling**: Database connection pooling for high throughput
- **Caching**: Response caching where appropriate

## 📊 Monitoring & Logging

The application includes comprehensive logging:

- **Request Logging**: All HTTP requests and webhook updates
- **Error Logging**: Detailed error context and stack traces
- **Performance Monitoring**: Database query performance tracking
- **Business Logic Logging**: Key business events and state changes

## 🤝 Contributing

When contributing to this project:

1. **Follow Type Safety**: Use TypeScript types from [Type Definitions](./TYPE_DEFINITIONS.md)
2. **Reference Examples**: Check [Usage Examples](./USAGE_EXAMPLES.md) for patterns
3. **Update Documentation**: Add new APIs to [API Documentation](./API_DOCUMENTATION.md)
4. **Write Tests**: Include unit and integration tests for new features
5. **Follow Code Style**: Use the established ESLint and Prettier configuration

## 📚 Additional Resources

- **NestJS Documentation**: https://docs.nestjs.com/
- **Prisma Documentation**: https://www.prisma.io/docs/
- **Telegraf Documentation**: https://telegraf.js.org/
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/

## 🐛 Troubleshooting

### Common Issues

**Database Connection Issues**
- Verify `POSTGRES_CONNECTION_STRING` environment variable
- Check database server availability
- Ensure Prisma migrations are applied

**Telegram Bot Issues**
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check webhook URL configuration
- Ensure webhook endpoint is accessible

**Storage Issues**
- Verify DigitalOcean Spaces credentials
- Check bucket permissions and ACL settings
- Ensure network connectivity to DigitalOcean

**Image Processing Issues**
- Verify `OPENAI_API_KEY` is valid
- Check Sharp library installation
- Ensure sufficient memory for image processing

For detailed troubleshooting, see the error handling examples in [Usage Examples](./USAGE_EXAMPLES.md#error-handling-examples).

---

*This documentation is automatically generated and maintained. For the most up-to-date information, refer to the individual documentation files linked above.*