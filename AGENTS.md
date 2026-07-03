# Project Agent Rules

- Do not run Puppeteer in this repository. For frontend checks, use simpler static/HTTP verification unless the user explicitly asks otherwise.

## Design system (web pages)

All public pages under `web/` share one visual language. When building or changing a page:

- Link the shared stylesheets with a cache-busting query (`?v=YYYYMMDD-N`, bump on change):
  `/shared/site-theme.css` (design tokens + components), and for pages with the site header also `/shared/site-header.css` + `/shared/site-header.js` with `<header data-site-header data-active="..." data-lang-ru="..." data-lang-en="...">`.
- Font is Inter (Google Fonts, weights 400–700). Never hardcode font stacks — use `var(--font-sans)`.
- Colors, spacing, radii and shadows come from CSS variables in site-theme.css: `--v-text`, `--v-muted`, `--v-line`, `--v-bg`, `--v-surface`, spacing scale `--v-space-1..8`, `--radius`, `hsl(var(--shadcn-border))`, `hsl(var(--primary))`, etc. Page CSS should contain layout only, not new colors.
- Reuse component classes from site-theme.css instead of inventing new ones: cards `.editor-card` / `.tool-block` (border + radius + surface + shadow), buttons `.primary-btn` (filled dark) and `.ghost-btn` / `.mini-btn` (outlined, min-height 40px, font-weight 750), kickers `.section-kicker`.
- Inputs: 1px `hsl(var(--shadcn-input))` border, `var(--radius)` radius, min-height 40px, `hsl(var(--background))` background.
- Pages are bilingual where it matters: `index.html` (Russian) + `en.html` (English), linked via the header language switcher.

### My places map page (`web/places/`)

- Desktop (≥900px): split screen — Leaflet map on the left, a scrollable side panel (~50%, max 760px) on the right. All feature info (title, description, large Instagram embed, actions), search and the recent list live in the panel; the map itself has no Leaflet popups for saved features (only for draft markers).
- Mobile (<900px): the panel becomes a right-side drawer (`.side-panel.open` slides it in over a dimmed overlay); a floating 📋 button on the map opens it, ✕ or the overlay closes it. Selecting a feature on the map opens the drawer.
- Selection state drives everything: `selectFeature()` renders the details panel, syncs the shareable URL and highlights selected tracks.
- Share URLs are path-based: `/places/point/<id>` and `/places/track/<id>`. `MapPagesController` (src/map-pages.controller.ts) serves these paths server-side with per-feature Open Graph tags injected into index.html; the SPA then reads the path and selects the feature. Legacy `#p=<id>`/`#t=<id>` hashes still work client-side.
- Instagram metadata (author, date, counters, caption, cover) is cached in the `instagramMeta` JSONB column and refreshed at most once a day via `POST /map-api/{points|tracks}/:id/instagram-meta` (triggered when a feature is opened). Covers are copied to DO Spaces under `places/covers/{kind}-{id}.jpg` because Instagram CDN URLs expire.

## Deployment

Production (https://vlandivir.com) deploys via GitHub Actions, **not** via `run-production-deploy.sh` (that script is legacy).

- Workflow: `.github/workflows/deploy-production.yml`, manual trigger only (`workflow_dispatch`) — run it from the Actions tab or with `gh workflow run deploy-production.yml`. Deploys the pushed state of the repo, so commit and push first.
- The workflow builds the Docker image (multi-stage: prisma generate → mini-app Vite build → nest build), pushes it to the DigitalOcean registry, then over SSH restarts the container on the droplet. TLS certs are mounted from the host (`/etc/letsencrypt/live/vlandivir.com/`).
- All runtime secrets are baked in as Docker build-args from GitHub repo secrets (`gh secret list --repo vlandivir/vlandivir-2025`). When code starts using a new env var: add it to `.env` locally, to the `ARG`/`ENV` pairs in `Dockerfile`, to `build-args` in `deploy-production.yml`, and create the GitHub secret (`gh secret set NAME`).
- Database: DigitalOcean Postgres, shared between local dev and prod — `POSTGRES_CONNECTION_STRING` in the local `.env` points at the same database the site uses. Migrations are not run during deploy; apply them from the local machine with `npx prisma migrate deploy` **before** deploying code that needs them. Never run `prisma migrate reset` or other destructive commands against this database.
