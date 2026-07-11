# vlandivir-2025

## Telegram Bot Commands and Examples

This project includes a Telegram bot with several useful commands. Notes are saved automatically from any text or photo you send to the bot.

### Creating a new note

Send a message or a photo caption to save a diary note for today. To store a note for a different date, start the first line with the desired date. The bot understands several common date formats.

```
02.01.2025
My note text
```

Supported date formats:

- `YYYY.MM.DD` or `YYYY-MM-DD`
- `DD.MM` or `MM/DD` (year defaults to the current one)
- `DD MMMM` (Russian month names, e.g. `2 января`)
- `DD MMM YYYY` (English month names, e.g. `2 Jan 2025`)

If you omit the date, the note is saved with today's date.

### `/d` or `/dairy`

Retrieves diary entries for a specific date.

- **date** (optional) — use `DD.MM.YYYY` to show a single day or `DD.MM`/`DD month` to see the same day across years.

Example:

```
/d 25.03.2024
```

### `/s`

Provides Serbian translations. Only works in private chats.

- **text** — Serbian word or phrase.

Example:

```
/s zdravo
```

### `/p` or `/phrase`

Translates a phrase between Russian, English and Serbian. Detects the input language and returns two translation variants for each of the other two languages. Only works in private chats.

- **text** — phrase in Russian, English or Serbian.

Example:

```
/p hello world
```

### `/history`

Generates an HTML page with all messages longer than 21 characters.

**Features:**

- Filters messages longer than 21 characters
- Generates a beautiful HTML page with chat history
- Provides a secret GUID-based link
- Includes message dates and images

Example:

```
/history
```

### `/help`

Shows a list of all available commands.

## Project setup

```bash
$ npm install

# Install Telegram Mini App dependencies
$ npm install --prefix telegram-app
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod

# Telegram Mini App dev server (separate)
$ npm run telegram-app:dev
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

## Code Style

See [docs/code-style.md](docs/code-style.md) for linting and formatting rules. Code is automatically checked before each commit.

## Project Structure

- **`src/`** — NestJS backend (bot, APIs, controllers)
- **`web/`** — Public web pages (home, places, gpx tools, subs)
- **`telegram-app/`** — Telegram Mini App (React + Vite, independent frontend)
- **`prisma/`** — Database schema and migrations
