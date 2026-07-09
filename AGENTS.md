# Project Agent Rules

New to the project? Start with [docs/project-overview.md](docs/project-overview.md) — architecture, controllers, bot commands, data model, web apps.

- Do not run Puppeteer in this repository. For frontend checks, use simpler static/HTTP verification unless the user explicitly asks otherwise.

## Design system (web pages)

All public pages under `web/` share one visual language, defined by `web/shared/site-theme.css` (shadcn-style HSL tokens + shared component styling). Page CSS must be **layout-only**: no palettes, no hardcoded colors, no font stacks.

### Tokens (the only allowed sources of color/spacing/type)

- Surfaces: `hsl(var(--background))` page, `hsl(var(--card))` panels, `hsl(var(--shadcn-muted))` soft fills, `hsl(var(--popover))` dropdowns.
- Text: `var(--v-text)` main, `var(--v-muted)` secondary, `hsl(var(--primary-foreground))` on filled-primary.
- Borders: `hsl(var(--shadcn-border))`; form inputs `hsl(var(--shadcn-input))`; focus ring `hsl(var(--shadcn-ring))`.
- Accents: `hsl(var(--primary))` (actions/links/progress), `hsl(var(--destructive))` (errors, warm highlights like the Instagram icon). Tints via alpha: `hsl(var(--primary) / 0.1)`.
- Spacing scale `--v-space-1` (4px) … `--v-space-8` (64px); page/panel/card paddings `--v-section-padding` / `--v-panel-padding` / `--v-card-padding`.
- Radius `var(--radius)` (nested elements `calc(var(--radius) - 2px)`); shadows `var(--v-shadow)` (cards) and `var(--shadcn-popover-shadow)` (popovers/modals).
- Fonts: `var(--font-sans)` (Inter, Google Fonts weights 400–700) and `var(--font-mono)`. 
- Legacy aliases (`--page`, `--paper`, `--ink`, `--line`, `--accent`, `--green`…) exist in the theme for old code; don't use them in new CSS and never redefine them in a page `:root`.

**Allowed hardcoded colors (the only exceptions):** overlays above photos/video (`rgba(0,0,0,.5)`, white text on them), dark letterbox backdrops behind media (`#000`), brand gradients (Instagram button), colors that are literal data (subtitle/route color options the user picks, canvas-rendering colors in JS — those also may keep their own fonts, e.g. Montserrat/Satoshi in the GPX PNG generator output), and the dark video-editor workbench palette in subs (`--charcoal`/`--coral`/`--yellow`/`--blue`).

### Components — reuse, don't reinvent

- Cards/panels: `.editor-card` (card padding), `.tool-block`/`.workflow-step`/`.archive-section` (section padding). All get border+radius+surface+shadow from the theme.
- Buttons: `.primary-btn` (filled), `.ghost-btn`/`.mini-btn`/`.tool-link` (outlined, min-height 40px, font-weight 750). Icon-only: add `.icon-btn`.
- Kickers: `.eyebrow`/`.section-kicker` (uppercase 12–13px, themed color); page width wrappers: `.page-shell`/`.shell`/`.container` (min(1160px, 100% − gutters)).
- Inputs get themed borders/radius from the theme automatically; keep min-height 40px.
- Badges/chips: `.badge`, `.meta-chip` (pill, `--secondary` fill).

### Page anatomy

- Content pages (home, files, gpx, subs): shared header `<header data-site-header data-active="..." data-lang-ru="..." data-lang-en="...">` + `/shared/site-header.css` + `/shared/site-header.js`; bilingual `index.html` (RU) / `en.html` (EN).
- App-like pages (places — fullscreen map, reels — unlisted catalog) skip the big header and use a compact `.panel-brand` link to `/` instead.
- Stylesheet link order on existing legacy pages is `page styles → site-theme.css` (the theme intentionally loads **last** as an override layer). New pages should do the opposite, clean pattern: `site-theme.css → page styles`, where page styles only add layout. Either way the rule is the same: the theme owns all colors.
- Every stylesheet link carries a cache-busting query `?v=YYYYMMDD-N` — bump it whenever you change that file.

### Checklist when touching a page

1. No new hex/rgb colors in page CSS (except the allowed list above); run `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' <file>` and justify every hit.
2. No `:root` palette overrides, no `font-family` other than the tokens.
3. Reused theme component classes before adding custom ones.
4. Bumped `?v=` on changed CSS.
5. Screenshot the page (dev server + browser preview) and compare against home/places for consistency.

### My places map page (`web/places/`)

- Desktop (≥900px): split screen — Leaflet map on the left, a scrollable side panel (~50%, max 760px) on the right. All feature info (title, description, large Instagram embed, actions), search and the recent list live in the panel; the map itself has no Leaflet popups for saved features (only for draft markers).
- Mobile (<900px): the panel becomes a right-side drawer (`.side-panel.open` slides it in over a dimmed overlay); a floating 📋 button on the map opens it, ✕ or the overlay closes it. Selecting a feature on the map opens the drawer.
- Selection state drives everything: `selectFeature()` renders the details panel, syncs the shareable URL and highlights selected tracks.
- Share URLs are path-based: `/places/point/<id>` and `/places/track/<id>`. `MapPagesController` (src/map-pages.controller.ts) serves these paths server-side with per-feature Open Graph tags injected into index.html; the SPA then reads the path and selects the feature. Legacy `#p=<id>`/`#t=<id>` hashes still work client-side.
- Instagram metadata (author, date, counters, caption, cover) is cached in the `instagramMeta` JSONB column and refreshed at most once a day via `POST /map-api/{points|tracks}/:id/instagram-meta` (triggered when a feature is opened). Covers are copied to DO Spaces under `places/covers/{kind}-{id}.jpg` because Instagram CDN URLs expire.

## Deployment

Production (https://vlandivir.com) deploys via GitHub Actions.

- Workflow: `.github/workflows/deploy-production.yml`, manual trigger only (`workflow_dispatch`) — run it from the Actions tab or with `gh workflow run deploy-production.yml`. Deploys the pushed state of the repo, so commit and push first.
- The workflow builds the Docker image (multi-stage: prisma generate → mini-app Vite build → nest build), pushes it to the DigitalOcean registry, then over SSH restarts the container on the droplet. TLS certs are mounted from the host (`/etc/letsencrypt/live/vlandivir.com/`).
- All runtime secrets are baked in as Docker build-args from GitHub repo secrets (`gh secret list --repo vlandivir/vlandivir-2025`). When code starts using a new env var: add it to `.env` locally, to the `ARG`/`ENV` pairs in `Dockerfile`, to `build-args` in `deploy-production.yml`, and create the GitHub secret (`gh secret set NAME`).
- Database: DigitalOcean Postgres, shared between local dev and prod — `POSTGRES_CONNECTION_STRING` in the local `.env` points at the same database the site uses. Migrations are not run during deploy; apply them from the local machine with `npx prisma migrate deploy` **before** deploying code that needs them. Never run `prisma migrate reset` or other destructive commands against this database.
