# Project Overview — vlandivir-2025

Orientation document for agents and new contributors. For web design rules and deployment details see [AGENTS.md](../AGENTS.md); for bot command usage examples see [README.md](../README.md).

**What it is:** a personal "everything" server at https://vlandivir.com — a NestJS monolith that runs a Telegram diary bot, a set of REST APIs, and several small web apps (map of places, Instagram reels archive, video subtitle editor, GPX tools). Single Docker container on a DigitalOcean droplet; PostgreSQL (DO managed, shared between dev and prod) and DigitalOcean Spaces (S3) for media.

## Stack

- **Backend:** NestJS 11 (Express), TypeScript, webhook-based Telegram bot via `telegraf`
- **DB:** PostgreSQL via Prisma 6 (`prisma/schema.prisma`; client generated into `src/generated/`)
- **Storage:** DigitalOcean Spaces, bucket `vlandivir-2025` (S3 SDK)
- **LLM:** OpenAI (image description, Whisper transcription, translation, reels tags/titles)
- **Media:** ffmpeg (audio extraction, subtitle rendering), yt-dlp (Instagram download), sharp + canvas (images, collages)
- **Frontends:** vanilla JS/HTML/CSS apps in `web/` (no build step), except `web/mini-app` — React + Vite (Telegram Mini App)

## Runtime layout

Entry: [src/main.ts](../src/main.ts) — HTTPS on 443 in prod (certs from `.secret/`), HTTP on 3000 in dev. Serves `web/*` statically: `/home`, `/shared`, `/gpx-route-png`, `/files`, `/places`, `/reels` (no index), `/subs`, `/subs-exp`, `/font`, `/mini-app` (Vite dist).

Root module: [src/app.module.ts](../src/app.module.ts) — ConfigModule (global), PrismaModule, ServicesModule, TelegramBotModule + all controllers.

## Controllers (HTTP API)

| Controller | Prefix | Purpose |
|---|---|---|
| [app.controller.ts](../src/app.controller.ts) | `/`, `/en`, `/health`, `/gpx-route-png`, `/subs`, `/files`… | Serves static pages / SPA index routes, health check |
| [notes-api.controller.ts](../src/notes-api.controller.ts) | `/notes-api` | Create a diary note with an image (auth: `x-note-api-key`). Uploads to Spaces, describes image via LLM, notifies via Telegram |
| [notifications-api.controller.ts](../src/notifications-api.controller.ts) | `/notifications-api` | Send a Telegram message to the primary chat (auth: `x-notification-api-key`) |
| [map-api.controller.ts](../src/map-api.controller.ts) | `/map-api` | CRUD for map points, tracks and the tag dictionary; Instagram-meta refresh (24h cache in JSONB, covers copied to Spaces); Google Maps short-link resolver. Reads are public, writes need `x-map-api-key` |
| [map-pages.controller.ts](../src/map-pages.controller.ts) | `/places/point/:id`, `/places/track/:id` | Server-side Open Graph tags for shareable map links (injected into `web/places/index.html`) |
| [reels-api.controller.ts](../src/reels-api.controller.ts) | `/reels-api` | Instagram reels archive: create/retry/delete, transcribe (Whisper), vision (frame extraction + LLM), tag/title generation, semantic search (`GET /search`) + embeddings backfill (`POST /embed-all`). Reads: `x-reels-page-key`, writes: `x-reels-api-key` |
| [reels-pages.controller.ts](../src/reels-pages.controller.ts) | `/reels/:secret`, `/reels/:secret/:id` | Unlisted reels catalog (secret = `REELS_PAGE_KEY`); per-reel OG tags |
| [subs.controller.ts](../src/subs.controller.ts) | `/subs-api` | Subtitle pipeline: upload vertical video → extract MP3 + waveform manifest → Whisper transcript → LLM translation → ffmpeg render with ASS subtitles → download. Everything cached in Spaces under `subs/*` by video hash |
| [mini-app/mini-app.controller.ts](../src/mini-app/mini-app.controller.ts) | `/mini-app-api` | Telegram Mini App backend: verifies signed initData, returns user profile/note count/avatar |

## Telegram bot (`src/telegram-bot/`)

[telegram-bot.service.ts](../src/telegram-bot/telegram-bot.service.ts) registers everything; updates arrive via webhook (`VLANDIVIR_2025_WEBHOOK_URL`) handled by [telegram-bot.controller.ts](../src/telegram-bot/telegram-bot.controller.ts) — no polling.

**Core behavior:** any text/photo/video sent to the bot is auto-saved as a diary `Note` (optional date in the first line, many formats — see [date-parser.rules.ts](../src/services/date-parser.rules.ts)). Photos get an LLM description. Channel posts are dual-saved to the channel chat and the creator's personal chat. Videos >20 MB can't be fetched via Bot API — use `/v <url>`.

**Commands:**

| Command | Handler | What it does |
|---|---|---|
| `/d`, `/dairy` | [dairy-commands.service.ts](../src/telegram-bot/dairy-commands.service.ts) | Show notes for a date (or same day across years) |
| `/history` | [history-commands.service.ts](../src/telegram-bot/history-commands.service.ts) | Generate HTML history page, upload to Spaces, return secret UUID link |
| `/s` | [serbian-commands.service.ts](../src/telegram-bot/serbian-commands.service.ts) | Serbian translation (private chats only) |
| `/p`, `/phrase` | [foreign-commands.service.ts](../src/telegram-bot/foreign-commands.service.ts) | RU/EN/SR phrase translation via LLM (private only) |
| `/c`, `/collage` | [collage-commands.service.ts](../src/telegram-bot/collage-commands.service.ts) | Interactive collage builder (3–5 photos, canvas rendering, inline-button flow via callback_query) |
| `/a` | inline | Open the Telegram Mini App |
| `/v`, `/video` | inline | Save a video by direct URL (bypasses 20 MB limit) |
| `/bar` | inline | Ask for location, show distance to a bar + static map |
| `/dl`, `/debuglog` | inline | Export in-memory debug log ([debug-log.service.ts](../src/services/debug-log.service.ts)) to Spaces |
| `/help` | inline | Command list |

## Shared services (`src/services/`)

- [storage.service.ts](../src/services/storage.service.ts) — all Spaces uploads/downloads (chat media, subs artifacts, arbitrary keys)
- [llm.service.ts](../src/services/llm.service.ts) — OpenAI wrapper (image description in Russian)
- [reels.service.ts](../src/services/reels.service.ts) — reels pipeline: yt-dlp download, cover/audio extraction, Whisper, frame vision, tag/title generation, search-embedding upsert; fire-and-forget background processing with status fields on the `Reel` model
- [embeddings.service.ts](../src/services/embeddings.service.ts) — semantic search: OpenAI `text-embedding-3-small` (override via `EMBEDDING_MODEL`) + pgvector; unified `Embedding` table (`kind`: reel | note | image, `chatId` scopes private kinds), raw-SQL upsert and cosine search
- [instagram-meta.service.ts](../src/services/instagram-meta.service.ts) — scrape Instagram post metadata (author, counters, caption, cover)
- [date-parser.service.ts](../src/services/date-parser.service.ts) — extract date from a note's first line
- [pdf.service.ts](../src/services/pdf.service.ts) — renders `/history pdf` export with pdfkit (works in prod; Cyrillic via the bundled `assets/fonts/NotoSans-Regular.ttf`)
- [debug-log.service.ts](../src/services/debug-log.service.ts) — in-memory ring buffer for bot debugging

## Data model (`prisma/schema.prisma`)

- **Note / Image / Video / BotResponse** — diary: note text + raw Telegram message JSON, attached media (Spaces URLs + LLM descriptions), bot replies. Keyed by `chatId` (BigInt) + `noteDate`
- **MapPoint / MapTrack / MapTag** — places map: coordinates or polylines, tags, `instagramMeta` JSONB cache
- **Reel** — Instagram reel archive: shortcode, status machine (`pending/ready/error`), transcript + vision fields with their own statuses, tags, yt-dlp metadata dump
- **ChatSettings / Todo / Question / Answer / TaskNote / TaskImage** — defined in the schema but not referenced anywhere in `src/` (planned features); the tables may contain data, check before dropping

## Web apps (`web/`)

| Dir | What | Notes |
|---|---|---|
| `home/` | Landing page | Bilingual: `index.html` (RU) / `en.html` (EN) |
| `places/` | Leaflet map of points/tracks | Vanilla JS SPA; split-panel desktop / drawer mobile; see AGENTS.md for detailed rules |
| `reels/` | Unlisted reels catalog | Vanilla JS; served only via `/reels/<secret>` |
| `subs/`, `subs-exp/` | Vertical-video subtitle editor (+ experimental variant) | Vanilla JS; dark "workbench" palette allowed |
| `gpx-route-png/` | GPX → PNG route renderer | Fully client-side |
| `files/` | Files page | Bilingual |
| `mini-app/` | Telegram Mini App | React + Vite; only `web/` dir with a build step (`npm run web:mini-app:build`) |
| `shared/` | `site-theme.css`, `site-header.{css,js}` | Design tokens — all pages must use them (see AGENTS.md) |

## Scripts (`src/scripts/`, run via npm scripts)

`update-image-descriptions`, `check-image-status`, `test-collage`, `generate-history-pdf`, `generate-history-pdf:html`, `generate-history-md` — maintenance/one-off utilities against the shared DB. Be careful: dev and prod use the same database.

## Environment variables

`TELEGRAM_BOT_TOKEN`, `VLANDIVIR_2025_WEBHOOK_URL`, `POSTGRES_CONNECTION_STRING`, `DO_SPACES_ACCESS_KEY`/`DO_SPACES_SECRET_KEY`, `OPENAI_API_KEY`, `NOTE_API_KEY`, `MAP_API_KEY`, `REELS_API_KEY`, `REELS_PAGE_KEY`, `ENVIRONMENT` (DEV/PROD), `PORT`. New vars must be added in four places: local `.env`, `Dockerfile` ARG/ENV, `deploy-production.yml` build-args, GitHub secret (see AGENTS.md → Deployment).

## Development

```bash
npm run start:dev        # watch mode, HTTP :3000
npm test                 # jest unit tests (*.spec.ts next to sources)
npm run lint             # eslint --fix
npm run web:mini-app:dev # mini-app Vite dev server
```

Deploy: commit + push, then manually run the `deploy-production.yml` GitHub Actions workflow. Migrations are applied from the local machine (`npx prisma migrate deploy`) **before** deploying. Never run destructive Prisma commands — the DB is shared with production.
