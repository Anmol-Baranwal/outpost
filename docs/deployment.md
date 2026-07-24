# Deployment Guide

Outpost consists of seven services (web dashboard, Discord bot, GitHub app, Slack bot, Teams bot, Linear sync, worker) sharing a single PostgreSQL database with pgvector. Each deployment environment (staging, production) has its own separate database — see [Environments](#environments-staging--production).

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
5. Add seven services from the repo, each pointing to its Dockerfile and `railway.toml` (set each service's Config file path to `apps/<app>/railway.toml`, Root Directory empty — build context must be repo root):
    - **outpost-web** — `apps/web/Dockerfile` (web service, port 3000, health check `/api/health`)
    - **outpost-discord-bot** — `apps/discord-bot/Dockerfile` (background worker, no public URL needed — gateway connects outbound)
    - **outpost-github-app** — `apps/github-app/Dockerfile` (web service, port 3200, needs public URL for webhooks)
    - **outpost-slack-bot** — `apps/slack-bot/Dockerfile` (background worker, Socket Mode — no public URL needed)
    - **outpost-teams-bot** — `apps/teams-bot/Dockerfile` (web service, needs public URL for the Bot Framework messaging endpoint)
    - **outpost-linear-sync** — `apps/linear-sync/Dockerfile` (web service, needs public URL for Linear webhooks)
    - **outpost-worker** — `apps/worker/Dockerfile` (background job processor — Postgres queue + scheduler, no public URL needed)
6. Share `DATABASE_URL` across all services using Railway's variable references (`${{Postgres.DATABASE_URL}}`)
7. Fill in the remaining secret environment variables (`DISCORD_TOKEN`, `ANTHROPIC_API_KEY`, etc. — see Environment Variables below)
8. Configure custom domains for the web dashboard, GitHub App webhook endpoint, Teams bot messaging endpoint, and Linear sync webhook endpoint

### What gets deployed

| Service             | Type       | Port (default)            | Health Check    |
| ------------------- | ---------- | ------------------------- | --------------- |
| outpost-web         | Web        | 3000                      | GET /api/health |
| outpost-discord-bot | Worker     | 3001                      | GET /health     |
| outpost-github-app  | Web        | 3200                      | GET /health     |
| outpost-slack-bot   | Worker     | 3002                      | GET /health     |
| outpost-teams-bot   | Web        | 3978 (bot), 3003 (health) | GET /health     |
| outpost-linear-sync | Web        | 3004                      | GET /health     |
| outpost-worker      | Worker     | 3003 (3005 locally)       | GET /health     |
| outpost-db          | PostgreSQL | --                        | --              |

Ports are the code's defaults (`process.env.PORT`/`HEALTH_PORT` fallback) — Railway may assign different values via its own `PORT` env var per service.

Note that the worker and the Teams bot both read the same `HEALTH_PORT` variable and both default to `3003`. That is fine on Railway, where each service runs in its own container, but it collides when running them together locally — which is why `.env.example` sets `HEALTH_PORT=3005`.

## Environment Variables

Copy `.env.example` and fill in all values. Key groups:

- **Database**: `DATABASE_URL`
- **Auth**: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- **AI**: `ANTHROPIC_API_KEY`, `PATHFINDER_URL`
- **Discord**: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`, `MONITORED_CHANNEL_IDS`
- **GitHub App**: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_TEAM_LOGINS` (optional)
- **Slack**: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `MONITORED_CHANNEL_IDS`, `TEAM_MEMBER_IDS` (optional)
- **Teams**: `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_TENANT_ID` (optional, blank for multi-tenant), `MONITORED_CHANNEL_IDS`
- **Linear sync**: `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_TEAM_ID`
- **Monitoring**: `SENTRY_DSN` (optional), `LOG_LEVEL`

## GitHub App Setup

Outpost's GitHub integration (`apps/github-app`) responds to issues and discussions the same way the Discord bot responds in threads. Creating the App is a one-time setup per GitHub org/repo.

1. **Create the App.** GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
    - Webhook URL: `https://<your-github-app-deployment>/api/webhooks/github` — needs a public URL (the deployed `outpost-github-app` Railway service, or a tunnel like ngrok for local dev on port 3200).
    - Webhook secret: generate a random string and save it — this becomes `GITHUB_WEBHOOK_SECRET`.
    - Permissions: **Issues: Read & write**, **Discussions: Read & write**.
    - Subscribe to events: **Issues**, **Issue comment**, **Discussions**.

    GitHub has no webhook event for comment reactions, so 👍/👎 feedback is picked up by a 24-hour poll job instead (`GITHUB_REACTION_POLL`) — no extra event subscription is needed for that.

2. **Generate credentials.** On the App's settings page, generate a private key (downloads a `.pem` file) — its full contents become `GITHUB_PRIVATE_KEY`. Note the **App ID** shown on the same page — that's `GITHUB_APP_ID`.

3. **Install the App.** App settings → Install App → pick the target repo (scope to one repo rather than the whole org for testing). After installing, the URL bar shows an `installation_id` — that's `GITHUB_INSTALLATION_ID`.

4. **Set environment variables.** Both `apps/github-app` (the webhook receiver) and the worker/web services (via `packages/outpost/shared`'s platform adapter registry) read:

    ```
    GITHUB_APP_ID=<app id>
    GITHUB_PRIVATE_KEY=<full .pem contents>
    GITHUB_INSTALLATION_ID=<installation id>
    GITHUB_WEBHOOK_SECRET=<webhook secret>
    ```

    Optional: `GITHUB_TEAM_LOGINS` (comma-separated GitHub logins treated as internal team members, used by triage logic).

5. **Deploy.** `outpost-github-app` is already defined as a Railway service (see the Quick Start section above) — point its Config file path at `apps/github-app/railway.toml`, leave Root Directory empty, add the env vars, deploy. Health check hits `GET /health`.

6. **Verify.** Open an issue on the installed repo. The agent should reply with an AI-generated answer plus a "Was this helpful? 👍/👎" prompt. React to it, then either wait for the next 24h poll or trigger `GITHUB_REACTION_POLL` manually to confirm the reaction lands as `feedback` on the `Message` row.

    Note: discussion-comment reactions aren't polled today — `GitHubAdapter.postDiscussionComment` returns a GraphQL node ID, not the numeric REST comment ID the reactions endpoint needs. Issue feedback works end-to-end; discussion feedback is a known follow-up.

## Docker Builds

Each app has its own Dockerfile using the Turborepo pruning pattern for efficient builds:

```bash
# Build web app
docker build -f apps/web/Dockerfile -t outpost-web .

# Build Discord bot
docker build -f apps/discord-bot/Dockerfile -t outpost-discord-bot .

# Build GitHub app
docker build -f apps/github-app/Dockerfile -t outpost-github-app .

# Build Slack bot
docker build -f apps/slack-bot/Dockerfile -t outpost-slack-bot .

# Build Teams bot
docker build -f apps/teams-bot/Dockerfile -t outpost-teams-bot .

# Build Linear sync
docker build -f apps/linear-sync/Dockerfile -t outpost-linear-sync .

# Build worker
docker build -f apps/worker/Dockerfile -t outpost-worker .
```

All images:

- Use multi-stage builds (prune -> install -> run)
- Run as non-root user (`outpost`, uid 1001)
- Include Docker HEALTHCHECK instructions
- Base on `node:20-alpine` for minimal size

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every PR and push to `main` and `staging` — so both the integration line and every production release are validated:

1. Install dependencies (`pnpm install --frozen-lockfile`)
2. Generate Prisma client
3. Build all packages
4. Lint
5. Type check
6. Run tests

## Environments (staging → production)

Railway hosts two environments in the `outpost` project, each with its **own** PostgreSQL instance (staging never touches production data):

`main` is the known-good release line: it is what production runs. Development work — features, fixes, chores — happens on branches, which merge into `staging` for integration testing. Nothing reaches `main` until it has soaked on staging.

| | staging | production |
| --- | --- | --- |
| Deploys from | `staging` branch (CI-gated) | `main` (CI-gated) |
| Web URL | `outpost-web-staging.up.railway.app` | `outpost.copilotkit.ai` |
| Database | own Postgres (isolated) | own Postgres |
| Role | integration / soak | known good |

Four services carry deploy triggers in both environments: `outpost-web`, `outpost-github-app`, `outpost-discord-bot`, `outpost-worker`. The remaining three (`outpost-slack-bot`, `outpost-teams-bot`, `outpost-linear-sync`) are optional integrations — deployed manually / left offline until their credentials are configured.

Railway's deploy triggers have "wait for CI" enabled, so a push only deploys after the CI check suite passes on that commit — for both branches.

### Shadow mode (staging safety)

Staging runs the agent with `SHADOW_MODE=true` on `outpost-worker`. The AI response
pipeline runs in full, but instead of posting to the source platform it persists the
response as a shadow `Message` row (`author: outpost-shadow`, `attachments.shadowMode: true`)
carrying the text it would have posted, plus confidence and latency. Inspect those rows
to verify agent behavior without replying to real users.

`SHADOW_MODE` gates both outbound paths: the `AI_RESPONSE` handler (every auto-response
to a user, posted via the platform adapters) and the `ONBOARDING_DIGEST` job, which
posts a daily digest straight to Discord via `DISCORD_DIGEST_CHANNEL_ID` using raw REST.
With shadow mode on, the digest is logged instead of posted.

When adding any new outbound post path, check `SHADOW_MODE` before posting — otherwise
staging will deliver to real users regardless of the flag.

### Promotion workflow

```
feature branch → PR → staging → CI → auto-deploys to STAGING → verify
release:        merge staging → main → CI → auto-deploys to PRODUCTION
```

Open pull requests against `staging`. On merge, Railway auto-deploys the staging
environment via its GitHub integration, where the change soaks in shadow mode.

Releasing is a deliberate act: merge `staging` into `main` (a PR from `staging` to
`main` is the auditable way to do it), and Railway deploys production from `main`.
Because `main` only ever receives changes that have already run on staging, it stays
"known good" — and its history is the record of what has been in production. No deploy
hooks needed on either side.

To roll production back, revert the offending commit on `main`; the next deploy picks
it up.

## Monitoring

### Structured Logging

All services use `@copilotkit/outpost/shared`'s `createLogger()` for JSON-structured logs:

```
{"timestamp":"2026-04-15T...","level":"info","service":"web","message":"Request processed","requestId":"abc123"}
```

### Alerts

`AlertManager` from `@copilotkit/outpost/shared` detects SLA breaches and bot failures. The default handler logs alerts; swap in a Slack webhook or PagerDuty handler for production.

### Error Tracking

The web app includes a Sentry stub (`apps/web/src/lib/sentry.ts`). Set `SENTRY_DSN` to activate. Without it, errors log to stderr.

## Health Checks

All seven services expose health endpoints returning JSON:

```json
{ "status": "ok", "service": "web", "version": "0.1.0", "uptime": 3600 }
```

- Web: `GET /api/health` (port 3000)
- Discord bot: `GET /health` (port 3001)
- GitHub app: `GET /health` (port 3200)
- Slack bot: `GET /health` (port 3002)
- Teams bot: `GET /health` (port 3003)
- Linear sync: `GET /health` (port 3004)
- Worker: `GET /health` (port 3003 by default; `HEALTH_PORT=3005` locally to avoid clashing with the Teams bot)

## Database Setup

After provisioning PostgreSQL (Railway supports pgvector via `CREATE EXTENSION`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The schema is managed by **versioned Prisma migrations** (`packages/outpost/db/prisma/migrations/`),
and `apps/web/start.sh` runs `prisma migrate deploy` on every container start. So a
deployed environment migrates itself — there is no manual step for staging or production.

To apply migrations by hand (e.g. against a fresh local database):

```bash
pnpm db:generate
pnpm --filter @copilotkit/outpost exec prisma migrate deploy --schema db/prisma/schema.prisma
```

> **Do not run `pnpm db:push` against staging or production.** `prisma db push` syncs the
> schema without recording a migration, which puts the database out of step with the
> migration history and makes the next `migrate deploy` fail or clobber changes. It is for
> throwaway local databases and prototyping only.

To create a new migration during development, use
`prisma migrate dev --name <description>` and commit the generated directory.

### Backups

Railway's managed Postgres handles storage-level durability, but there is **no documented
application-level backup/restore procedure yet** — no scheduled `pg_dump`, and no rehearsed
restore. Treat that as an open gap before relying on this database for anything you cannot
reconstruct.
