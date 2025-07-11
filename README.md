# vlandivir-2025

## Telegram Bot Commands

This project includes a Telegram bot with the following commands:

### `/dairy` or `/d` - Dairy Notes
Retrieves and displays diary entries for a specific date or all years for a given day/month.

### `/s` - Serbian Translation
Provides Serbian translations for text.

### `/history` - Chat History
Creates an HTML page with all messages from the current chat that are longer than 42 characters. The page is accessible via a secret link that is sent to the chat.

### `/t` or `/task` - Create Todo
Creates a new todo item with tags, contexts, projects, optional priority and due date.

### `/help` - Command List
Shows a list of available commands with brief descriptions.

**Features:**
- Filters messages longer than 42 characters
- Generates a beautiful HTML page with chat history
- Provides a secret GUID-based link
- Includes message dates and images
- Auto-expires after 24 hours for security

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
