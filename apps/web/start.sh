#!/bin/sh
set -e

# Run pending database migrations before starting
node ./node_modules/prisma/build/index.js migrate deploy --schema packages/outpost/db/prisma/schema.prisma

# Start Next.js
exec node apps/web/server.js
