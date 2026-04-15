# ── Stage 1: prune the monorepo to only what @outpost/web needs ──────────────
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g turbo@2

COPY . .
RUN turbo prune @outpost/web --docker

# ── Stage 2: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install only the pruned lockfile first (layer cache)
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Copy pruned source and build
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@outpost/web

# ── Stage 3: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl

RUN addgroup --system --gid 1001 outpost && \
    adduser --system --uid 1001 outpost

WORKDIR /app

COPY --from=installer --chown=outpost:outpost /app/apps/web/.next/standalone ./
COPY --from=installer --chown=outpost:outpost /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=outpost:outpost /app/apps/web/public ./apps/web/public

USER outpost
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
