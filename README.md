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

### `/t` or `/task`

Creates a new todo item.

- **content** — description of the todo item.
- `@tag` — add tags.
- `.context` — specify contexts.
- `!project` — assign projects (multiword names are allowed).
- `(A)` — set priority with a letter in parentheses.
- `:<date>` or `:<date> HH:MM` — optional due date. `<date>` accepts the same formats as in the note examples above.
- You can also use words like `tomorrow` or day names (`sunday`, `понедельник`, etc.) for the due date.
- **Images** — you can send images with your task to add them as notes. Images will be automatically described using AI.

To update an existing task, start the command with its key:
`/t T-20250710-03 ...`. New tags and contexts are appended while
projects and due dates are replaced. The text part can be empty.
Use `-canceled`, `-done`, `-in-progress`, `-started`, or `-snoozed[days]` (e.g., `-snoozed4` or `-snoozed 4`) to set the status.
Snoozed tasks are hidden from `/tl` until their snooze period expires.

Example:

```
/task (B) @work .office !Big Project :2025.07.31 09:00 Prepare report
```

### `/tl`

Lists unfinished todo items in a single message. Each task has an inline button
showing its key so you can quickly start editing. Tasks with images show a 📷 icon
with the number of images. You can filter by the same
`@tag`, `.context` and `!project` tokens as in `/task`.

Example:

```
/tl @work .office
```

### `/th`

Generates an HTML page with all tasks and their history stored on DigitalOcean Spaces.

Tasks are organized into three categories:

- **Unfinished**: Active tasks sorted by due date and key
- **Snoozed**: Tasks that are currently snoozed, sorted by snooze expiration date and key
- **Finished**: Completed or canceled tasks sorted by creation date

The snoozed until date is displayed for snoozed tasks.
History lines show only what changed instead of repeating the full task text,
and the first history entry now includes the task title.

### `/qa`

Starts an interactive flow to add a question.

1. Send `/qa` and provide the question text when prompted.
2. Choose its type (string, number or boolean) using the inline buttons.

### `/ql`

Lists all questions for the current chat.

Example:

```
/ql
```

### `/qq`

Shows the list of questions with their answers for the specified date (or today if no date is given).

Example:

```
/qq 02.01.2025
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

## Code Style

See [docs/code-style.md](docs/code-style.md) for linting and formatting rules. Code is automatically checked before each commit.
