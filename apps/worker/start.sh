#!/bin/sh
set -e
echo "Running database migrations..."
npx prisma migrate deploy --schema packages/outpost/db/prisma/schema.prisma
echo "Migrations complete. Starting worker..."
exec node apps/worker/dist/index.js
