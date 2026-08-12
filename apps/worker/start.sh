#!/bin/sh
set -e

PRISMA="node /opt/prisma/node_modules/prisma/build/index.js"
SCHEMA="packages/outpost/db/prisma/schema.prisma"

echo "Running database migrations..."
$PRISMA migrate deploy --schema "$SCHEMA"

# Schema-drift guard.
#
# `migrate deploy` only compares the migrations directory against the
# _prisma_migrations bookkeeping table. It never inspects the actual schema, so a
# migration recorded as applied but never executed is invisible to it — it
# cheerfully reports "No pending migrations to apply" against a database missing
# the tables that migration declares.
#
# That is exactly what happened: production had 0001_init recorded as applied
# while the SystemConfig table it declares did not exist. The worker read that
# table during boot, threw, and died before binding /health, so every deploy from
# 2026-08-07 failed with nothing but "1/1 replicas never became healthy" — nine
# days of a five-minute healthcheck timeout that looked like a broken image.
#
# `migrate diff` compares the LIVE DATABASE against schema.prisma and exits
# non-zero when they differ, which catches that class. Running it here means the
# deploy fails in seconds with the drifted object named, instead of timing out.
#
# Deliberately fatal rather than a warning: the worker's sync mappings come from
# the database, and one running against a schema it does not match would write
# wrong statuses to Linear. Failing the deploy keeps the previous replica serving.
echo "Checking for schema drift..."
if ! $PRISMA migrate diff \
    --from-schema-datasource "$SCHEMA" \
    --to-schema-datamodel "$SCHEMA" \
    --exit-code; then
    echo ""
    echo "FATAL: the database does not match schema.prisma (see the diff above)."
    echo "A migration may be recorded as applied without having run."
    echo "Compare models in schema.prisma against the live tables before redeploying."
    exit 1
fi

echo "Migrations complete and schema matches. Starting worker..."
exec node apps/worker/dist/index.js
