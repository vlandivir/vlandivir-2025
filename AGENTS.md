# Project Agent Rules

- Do not run Puppeteer in this repository. For frontend checks, use simpler static/HTTP verification unless the user explicitly asks otherwise.

## Deployment

Production (https://vlandivir.com) deploys via GitHub Actions, **not** via `run-production-deploy.sh` (that script is legacy).

- Workflow: `.github/workflows/deploy-production.yml`, manual trigger only (`workflow_dispatch`) — run it from the Actions tab or with `gh workflow run deploy-production.yml`. Deploys the pushed state of the repo, so commit and push first.
- The workflow builds the Docker image (multi-stage: prisma generate → mini-app Vite build → nest build), pushes it to the DigitalOcean registry, then over SSH restarts the container on the droplet. TLS certs are mounted from the host (`/etc/letsencrypt/live/vlandivir.com/`).
- All runtime secrets are baked in as Docker build-args from GitHub repo secrets (`gh secret list --repo vlandivir/vlandivir-2025`). When code starts using a new env var: add it to `.env` locally, to the `ARG`/`ENV` pairs in `Dockerfile`, to `build-args` in `deploy-production.yml`, and create the GitHub secret (`gh secret set NAME`).
- Database: DigitalOcean Postgres, shared between local dev and prod — `POSTGRES_CONNECTION_STRING` in the local `.env` points at the same database the site uses. Migrations are not run during deploy; apply them from the local machine with `npx prisma migrate deploy` **before** deploying code that needs them. Never run `prisma migrate reset` or other destructive commands against this database.
