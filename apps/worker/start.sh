#!/bin/sh
set -e

PRISMA="node /opt/prisma/node_modules/prisma/build/index.js"
SCHEMA="packages/outpost/db/prisma/schema.prisma"

echo "[worker] Running database migrations..."
# `migrate deploy` failing is far more common than drift and, left to bare `set -e`,
# dies with Prisma's output and no framing — in a script whose entire purpose is
# naming the real cause. Both web and worker migrate into the same database and
# their Railway logs interleave, hence the [worker] prefixes throughout.
if ! $PRISMA migrate deploy --schema "$SCHEMA"; then
    echo ""
    echo "[worker] FATAL: prisma migrate deploy failed (see the error above)."
    echo "[worker] Common causes: a migration recorded as failed in _prisma_migrations (P3009),"
    echo "[worker] a migration file edited after it was applied (P3006), or an unreachable database."
    echo "[worker] The worker will not start against a database whose migrations did not apply."
    exit 1
fi

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
# ONLY ONE DIRECTION IS FATAL. `migrate diff` is bidirectional: it also emits DROP
# statements for anything in the live database that schema.prisma does not declare
# — a hand-added index, a leftover from a reverted feature, another tool's table,
# or (routinely) a migration a sibling service deployed before this image shipped.
# Failing on those would turn every normal schema-advancing rollout into a worker
# outage, because restartPolicyType="ALWAYS" would crash-loop this container until
# its own new image landed. Missing objects are the class that actually breaks the
# worker, so the guard fails on CREATE/ADD and merely warns on DROP.
#
# Deliberately fatal rather than a warning: the worker's sync mappings come from
# the database, and one running against a schema it does not match would write
# wrong statuses to Linear. Failing the deploy keeps the previous replica serving.
echo "[worker] Checking for schema drift..."
set +e
DRIFT_SQL=$($PRISMA migrate diff \
    --from-schema-datasource "$SCHEMA" \
    --to-schema-datamodel "$SCHEMA" \
    --script 2>&1)
DRIFT_STATUS=$?
set -e

if [ "$DRIFT_STATUS" -ne 0 ]; then
    echo ""
    echo "$DRIFT_SQL"
    echo ""
    echo "[worker] FATAL: could not check for schema drift — prisma migrate diff exited $DRIFT_STATUS."
    echo "[worker] This is a tool or connectivity failure, NOT confirmed drift: the database"
    echo "[worker] was never successfully compared. Check DATABASE_URL and that the database"
    echo "[worker] is reachable from this container, then redeploy."
    exit 1
fi

# Statements that CREATE or ADD are objects schema.prisma declares and the database
# lacks — the outage class. Anything else in the diff is an extra object the schema
# does not know about, which the worker does not care about.
MISSING=$(printf '%s\n' "$DRIFT_SQL" | grep -Ei '^[[:space:]]*(CREATE|ALTER[[:space:]]+TABLE.*[[:space:]]ADD[[:space:]])' || true)
EXTRA=$(printf '%s\n' "$DRIFT_SQL" | grep -Ei '^[[:space:]]*DROP' || true)

if [ -n "$EXTRA" ]; then
    echo "[worker] NOTE: the database contains objects schema.prisma does not declare."
    echo "[worker] Not fatal — this is normal while a sibling service is mid-rollout."
    printf '%s\n' "$EXTRA" | sed 's/^/[worker]   /'
fi

if [ -n "$MISSING" ]; then
    echo ""
    echo "[worker] Objects schema.prisma declares that the database does not have:"
    printf '%s\n' "$MISSING" | sed 's/^/[worker]   /'
    echo ""
    if [ "${OUTPOST_ALLOW_SCHEMA_DRIFT:-0}" = "1" ]; then
        echo "[worker] WARNING: OUTPOST_ALLOW_SCHEMA_DRIFT=1 is set — starting anyway."
        echo "[worker] WARNING: TRACKER_SYNC may write wrong statuses to Linear until this is repaired."
        echo "[worker] WARNING: unset this variable as soon as the schema is fixed."
    else
        echo "[worker] FATAL: the database is missing objects that schema.prisma declares."
        echo "[worker] A migration may be recorded as applied without having run."
        echo "[worker] Compare models in schema.prisma against the live tables before redeploying."
        echo "[worker] To start anyway during an incident, set OUTPOST_ALLOW_SCHEMA_DRIFT=1."
        exit 1
    fi
fi

echo "[worker] Migrations complete and schema matches. Starting worker..."
exec node apps/worker/dist/index.js
