#!/bin/sh
# Run Prisma db push to ensure schema is up to date (creates tables on first run)
node node_modules/prisma/build/index.js db push --schema=packages/outpost/db/prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 || echo "Warning: prisma db push failed, continuing anyway"

# Start Next.js
exec node apps/web/server.js
