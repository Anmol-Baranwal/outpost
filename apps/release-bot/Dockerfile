# ── Stage 1: prune the monorepo to only what @copilotkit/outpost-release-bot needs ──
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app

# No pnpm in this stage: pruning runs on turbo alone.
# Pinned in step with the root devDependency, so the pruner cannot drift.
RUN npm install -g turbo@2.3.0

COPY . .
RUN turbo prune @copilotkit/outpost-release-bot --docker

# ── Stage 2: install dependencies and build ──────────────────────────────────
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Matches the root package.json's packageManager field; corepack honours that
# field, so a different pin here would be silently ignored at best.
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.json ./tsconfig.json
RUN pnpm turbo run build --filter=@copilotkit/outpost-release-bot

# ── Stage 3: production image ────────────────────────────────────────────────
# No Prisma, no database, no health server: this service talks to GitHub, YouTube,
# OpenAI and Discord over HTTPS, announces what is new, and exits.
FROM node:20-alpine AS runner

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 outpost && \
    adduser --system --uid 1001 outpost

WORKDIR /app

COPY --from=installer --chown=outpost:outpost /app/node_modules ./node_modules
COPY --from=installer --chown=outpost:outpost /app/apps/release-bot/dist ./apps/release-bot/dist
COPY --from=installer --chown=outpost:outpost /app/apps/release-bot/package.json ./apps/release-bot/package.json
# pnpm's isolated layout keeps an app's own deps here, symlinked into the root
# store, so this has to be copied for the first runtime dependency added not to
# fail only in production. The destination is named explicitly: a COPY whose
# source is a directory copies its *contents*, so a bare destination would
# scatter the packages across apps/release-bot/ instead.
COPY --from=installer --chown=outpost:outpost /app/apps/release-bot/node_modules ./apps/release-bot/node_modules
COPY --from=installer --chown=outpost:outpost /app/package.json ./package.json

USER outpost

CMD ["node", "apps/release-bot/dist/index.js"]
