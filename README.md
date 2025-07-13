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

### `/history`
Generates an HTML page with all messages longer than 42 characters.

**Features:**
- Filters messages longer than 42 characters
- Generates a beautiful HTML page with chat history
- Provides a secret GUID-based link
- Includes message dates and images

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
- `:<date>` or `:<date> HH:MM` — optional due date. `<date>` accepts the same formats as in the note examples above.

To update an existing task, start the command with its key:
`/t T-20250710-3 ...`. New tags and contexts are appended while
projects and due dates are replaced. The text part can be empty.
Use `-canceled`, `-done`, `-in-progress` or `-started` to set the status.

Example:
```
/task (B) @work .office !Big Project :2025.07.31 09:00 Prepare report
```

### `/tl`
Lists unfinished todo items. You can filter by the same `@tag`, `.context` and `!project` tokens as in `/task`.

Example:
```
/tl @work .office
```

### `/help`
Shows a list of all available commands.

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
