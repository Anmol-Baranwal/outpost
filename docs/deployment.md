# Deployment Guide

Outpost consists of three services (web dashboard, Discord bot, GitHub app) sharing a single PostgreSQL database with pgvector.

## Prerequisites

- Node.js 20+
- PostgreSQL 16 with pgvector extension
- Docker (for containerized deployment)
- Railway account (recommended) or equivalent PaaS

## Quick Start with Railway

Railway auto-deploys from GitHub and natively supports Docker-based services.

1. Push the repo to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Add a **PostgreSQL** service (Railway has native Postgres with pgvector support)
4. Enable pgvector: connect to the database and run `CREATE EXTENSION IF NOT EXISTS vector;`
5. Add three services from the repo, each pointing to its Dockerfile:
   - **outpost-web** — `apps/web/Dockerfile` (web service, port 3000, health check `/api/health`)
   - **outpost-discord-bot** — `apps/discord-bot/Dockerfile` (background worker)
   - **outpost-github-app** — `apps/github-app/Dockerfile` (web service, port 3200, needs public URL for webhooks)
6. Share `DATABASE_URL` across all services using Railway's variable references (`${{Postgres.DATABASE_URL}}`)
7. Fill in the remaining secret environment variables (`DISCORD_TOKEN`, `ANTHROPIC_API_KEY`, etc.)
8. Configure custom domains for the web dashboard and GitHub App webhook endpoint

### What gets deployed

| Service              | Type       | Port | Health Check       |
|----------------------|------------|------|--------------------|
| outpost-web          | Web        | 3000 | GET /api/health    |
| outpost-discord-bot  | Worker     | 3001 | GET /health        |
| outpost-github-app   | Web        | 3200 | GET /health        |
| outpost-db           | PostgreSQL | --   | --                 |

## Environment Variables

Copy `.env.example` and fill in all values. Key groups:

- **Database**: `DATABASE_URL`
- **Auth**: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- **AI**: `ANTHROPIC_API_KEY`, `PATHFINDER_URL`
- **Discord**: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`
- **GitHub App**: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET`
- **Monitoring**: `SENTRY_DSN` (optional), `LOG_LEVEL`

## Docker Builds

Each app has its own Dockerfile using the Turborepo pruning pattern for efficient builds:

```bash
# Build web app
docker build -f apps/web/Dockerfile -t outpost-web .

# Build Discord bot
docker build -f apps/discord-bot/Dockerfile -t outpost-discord-bot .

# Build GitHub app
docker build -f apps/github-app/Dockerfile -t outpost-github-app .
```

All images:
- Use multi-stage builds (prune -> install -> run)
- Run as non-root user (`outpost`, uid 1001)
- Include Docker HEALTHCHECK instructions
- Base on `node:20-alpine` for minimal size

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every PR and push to main:

1. Install dependencies (`pnpm install --frozen-lockfile`)
2. Generate Prisma client
3. Build all packages
4. Lint
5. Type check
6. Run tests

On merge to main, Railway auto-deploys via its GitHub integration — no deploy hooks needed.

## Monitoring

### Structured Logging

All services use `@copilotkit/outpost-shared`'s `createLogger()` for JSON-structured logs:

```
{"timestamp":"2026-04-15T...","level":"info","service":"web","message":"Request processed","requestId":"abc123"}
```

### Alerts

`AlertManager` from `@copilotkit/outpost-shared` detects SLA breaches and bot failures. The default handler logs alerts; swap in a Slack webhook or PagerDuty handler for production.

### Error Tracking

The web app includes a Sentry stub (`apps/web/src/lib/sentry.ts`). Set `SENTRY_DSN` to activate. Without it, errors log to stderr.

## Health Checks

All three services expose health endpoints returning JSON:

```json
{"status": "ok", "service": "web", "version": "0.1.0", "uptime": 3600}
```

- Web: `GET /api/health` (port 3000)
- Discord bot: `GET /health` (port 3001)
- GitHub app: `GET /health` (port 3200)

## Database Setup

After provisioning PostgreSQL (Railway supports pgvector via `CREATE EXTENSION`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then run migrations:

```bash
pnpm db:generate
pnpm db:push
```
