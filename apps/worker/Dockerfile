# ── Stage 1: prune the monorepo to only what @copilotkit/outpost-worker needs ──────
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g turbo@2

COPY . .
RUN turbo prune @copilotkit/outpost-worker --docker

# ── Stage 2: install dependencies and build ──────────────────────────────────
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.json ./tsconfig.json
RUN pnpm turbo run build --filter=@copilotkit/outpost-worker

# ── Stage 3: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl

RUN addgroup --system --gid 1001 outpost && \
    adduser --system --uid 1001 outpost

WORKDIR /app

COPY --from=installer --chown=outpost:outpost /app/node_modules ./node_modules
COPY --from=installer --chown=outpost:outpost /app/apps/worker/dist ./apps/worker/dist
COPY --from=installer --chown=outpost:outpost /app/apps/worker/package.json ./apps/worker/package.json
# pnpm's isolated layout keeps the app's own deps here (symlinked into root .pnpm) — required at runtime.
COPY --from=installer --chown=outpost:outpost /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=installer --chown=outpost:outpost /app/packages ./packages
COPY --from=installer --chown=outpost:outpost /app/package.json ./package.json

COPY --chown=outpost:outpost apps/worker/start.sh ./apps/worker/start.sh
RUN chmod +x apps/worker/start.sh

# Prisma CLI for running migrations at startup (installed standalone, mirrors apps/web/Dockerfile —
# the pnpm workspace .bin paths don't resolve reliably in the pruned production image).
# Pinned to the lockfile's version, not the `prisma@6` range: start.sh now branches on
# this CLI's `migrate diff` output to decide whether the worker may boot at all, so a
# floating 6.x could change that contract and block every deploy. Keep in step with
# @prisma/client — a CLI/client mismatch can itself report false drift.
RUN npm install --prefix /opt/prisma --no-save prisma@6.19.3

USER outpost
ENV NODE_ENV=production
ENV HEALTH_PORT=3005
EXPOSE 3005

# Follows the same PORT-over-HEALTH_PORT precedence as src/index.ts. Hardcoding 3005
# meant that whenever the platform injected PORT, the app moved and this probe failed
# forever against a healthy worker. 127.0.0.1 rather than localhost, which can resolve
# to ::1 inside the container and be refused (see apps/web/Dockerfile).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-${HEALTH_PORT:-3005}}/health" || exit 1

CMD ["./apps/worker/start.sh"]
