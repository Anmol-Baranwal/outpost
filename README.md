# Outpost

AI-powered support operations platform by CopilotKit. Outpost unifies customer support across Discord, GitHub, and the web into a single intelligent hub with AI-assisted ticket management, knowledge base search, and proactive customer engagement.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        apps/web (Next.js)                       │
│   Dashboard · Accounts · Tickets · Docs · Agents · Broadcasts  │
├─────────────────────────────────────────────────────────────────┤
│          apps/discord-bot          │     apps/github-app        │
│   Slash commands · Thread mgmt    │  Issue/Discussion webhooks  │
├──────────┬──────────┬─────────────┼────────────┬────────────────┤
│  pkg/ai  │ pkg/queue│  pkg/shared │   pkg/db   │                │
│ Pathfinder│ Postgres │  Types &    │   Prisma   │                │
│ + Claude │ Job Queue│  Constants  │   Schema   │                │
├──────────┴──────────┴─────────────┴────────────┘                │
│                      PostgreSQL 16 + pgvector                    │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for local PostgreSQL)

### Setup

```bash
# Clone the repo
git clone git@github.com:CopilotKit/outpost.git
cd outpost

# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d

# Set up environment
cp .env.example .env
# Edit .env with your values

# Generate Prisma client and push schema
pnpm db:generate
pnpm db:push

# Seed the database
pnpm db:seed

# Start development
pnpm dev
```

### Key Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps and packages |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run all tests |
| `pnpm format` | Format code with Prettier |

## Project Structure

```
outpost/
├── apps/
│   ├── web/              # Next.js web dashboard
│   ├── discord-bot/      # Discord bot for support channels
│   └── github-app/       # GitHub App for issue/discussion tracking
├── packages/
│   ├── ai/               # AI pipeline (Pathfinder + Claude)
│   ├── db/               # Prisma schema and database client
│   ├── queue/            # Postgres-based job queue
│   └── shared/           # Shared types, constants, utilities
├── docker-compose.yml    # Local PostgreSQL with pgvector
└── turbo.json            # Turborepo pipeline config
```

## License

Licensed under the [Elastic License 2.0 (ELv2)](./LICENSE). See the LICENSE file for details.
