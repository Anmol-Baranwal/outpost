#!/bin/sh
set -e

# Run pending database migrations before starting
node /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema packages/outpost/db/prisma/schema.prisma

# Start Next.js
# Bind all interfaces. Docker sets HOSTNAME to the container id, which Next's
# standalone server would otherwise bind to — making the loopback healthcheck
# (wget localhost:3000/api/health) fail even though the app serves fine.
export HOSTNAME=0.0.0.0
exec node apps/web/server.js
