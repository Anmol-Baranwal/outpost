# ── Stage 1: prune the monorepo to only what @copilotkit/outpost-web needs ──────────────
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g turbo@2

COPY . .
RUN turbo prune @copilotkit/outpost-web --docker

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
# turbo prune omits the root tsconfig.json that packages/outpost/tsconfig.base.json extends
COPY --from=pruner /app/tsconfig.json ./tsconfig.json
RUN pnpm turbo run build --filter=@copilotkit/outpost-web

# ── Stage 3: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl

RUN addgroup --system --gid 1001 outpost && \
    adduser --system --uid 1001 outpost

WORKDIR /app

COPY --from=installer --chown=outpost:outpost /app/apps/web/.next/standalone ./
COPY --from=installer --chown=outpost:outpost /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=outpost:outpost /app/apps/web/public ./apps/web/public
# Prisma query engine for linux-musl (required by Next.js standalone)
COPY --from=installer --chown=outpost:outpost /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node ./node_modules/.prisma/client/
COPY --from=installer --chown=outpost:outpost /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/schema.prisma ./node_modules/.prisma/client/
# Also copy engine to .next/server where standalone bundle looks for it
COPY --from=installer --chown=outpost:outpost /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node ./apps/web/.next/server/
COPY --from=installer --chown=outpost:outpost /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/schema.prisma ./apps/web/.next/server/
# Prisma schema for db push on first run
COPY --from=installer --chown=outpost:outpost /app/packages/outpost/db/prisma ./packages/outpost/db/prisma

USER outpost
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

COPY --from=installer --chown=outpost:outpost /app/apps/web/start.sh ./apps/web/start.sh
COPY --from=installer --chown=outpost:outpost /app/node_modules/.pnpm/prisma*/node_modules/prisma ./node_modules/prisma
COPY --from=installer --chown=outpost:outpost /app/node_modules/.pnpm/@prisma+engines*/node_modules/@prisma/engines ./node_modules/@prisma/engines

CMD ["sh", "apps/web/start.sh"]
