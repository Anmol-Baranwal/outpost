#!/bin/sh
set -e
echo "Running database migrations..."
node /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema packages/outpost/db/prisma/schema.prisma
echo "Migrations complete. Starting worker..."
exec node apps/worker/dist/index.js
