# vlandivir-2025

## Telegram Bot Commands and Examples

This project includes a Telegram bot with several useful commands. Notes are saved automatically from any text or photo you send to the bot.

### Creating a new note
Send a message or a photo caption to save a diary note for today. To store a note for a different date, start the first line with the desired date in a supported format such as `DD.MM.YYYY`, `DD.MM` or `DD month`.

```
02.01.2025
My note text
```

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

### `/history`
Generates an HTML page with all messages longer than 42 characters.

Example:
```
/history
```

### `/t` or `/task`
Creates a new todo item.
- **content** — description of the todo item.
- `@tag` — add tags.
- `.context` — specify contexts.
- `!project` — assign projects (multiword names are allowed).
- `(A)` — set priority with a letter in parentheses.
- `:YYYY.MM.DD` or `:YYYY.MM.DD HH:MM` — optional due date.

Example:
```
/task (B) @work .office !Big Project :2025.07.31 09:00 Prepare report
```

### `/help`
Shows a list of all available commands.

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
