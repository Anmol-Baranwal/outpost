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
set +e
$PRISMA migrate diff \
    --from-schema-datasource "$SCHEMA" \
    --to-schema-datamodel "$SCHEMA" \
    --exit-code
DRIFT_STATUS=$?
set -e

# --exit-code has three outcomes: 0 no difference, 2 a difference, and anything
# else the CLI itself failing (database unreachable, bad DATABASE_URL, schema
# engine did not start). Those are different problems and must not be reported
# with the same message — a script whose whole purpose is naming the real cause
# should not send the on-call hunting for drift that was never detected.
if [ "$DRIFT_STATUS" -eq 2 ]; then
    echo ""
    echo "FATAL: the database does not match schema.prisma (see the diff above)."
    echo "A migration may be recorded as applied without having run."
    echo "Compare models in schema.prisma against the live tables before redeploying."
    exit 1
elif [ "$DRIFT_STATUS" -ne 0 ]; then
    echo ""
    echo "FATAL: could not check for schema drift — prisma migrate diff exited $DRIFT_STATUS."
    echo "This is a tool or connectivity failure, NOT confirmed drift: the database"
    echo "was never successfully compared. Check DATABASE_URL and that the database"
    echo "is reachable from this container, then redeploy."
    exit 1
fi

echo "Migrations complete and schema matches. Starting worker..."
exec node apps/worker/dist/index.js
