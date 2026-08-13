#!/bin/sh
set -e

# Until `exec node` below, PID 1 is this shell. Linux discards signals that PID 1
# has no handler for, so without this a SIGTERM arriving during migrate deploy is
# ignored outright and the platform waits out the full grace period before
# SIGKILLing — potentially mid-migration.
trap 'echo "[worker] received SIGTERM during startup, aborting"; exit 143' TERM
trap 'echo "[worker] received SIGINT during startup, aborting";  exit 130' INT

PRISMA="node /opt/prisma/node_modules/prisma/build/index.js"
SCHEMA="packages/outpost/db/prisma/schema.prisma"

echo "[worker] Running database migrations..."
# A migrate deploy failure is far more common than drift and, left to bare `set -e`,
# dies with Prisma's output and no framing — in a script whose whole purpose is
# naming the real cause. web and worker migrate into the same database and their
# logs interleave, hence the [worker] prefixes throughout.
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
# while the SystemConfig table it declares did not exist. Every deploy from
# 2026-08-07 failed with nothing but "1/1 replicas never became healthy" — nine
# days of a five-minute healthcheck timeout that looked like a broken image.
#
# `migrate diff --exit-code` compares the LIVE DATABASE against schema.prisma:
# 0 = identical, 2 = they differ, anything else = the CLI itself failed
# (unreachable database, bad DATABASE_URL, schema engine did not start). Those
# last two are different problems and must not share a message — a script whose
# purpose is naming the real cause should not send the on-call hunting for drift
# that was never detected.
#
# ANY difference is fatal, deliberately. An earlier revision tried to classify the
# diff and fail only on missing objects, so that a sibling service mid-rollout
# (which shows up as an extra object) would not block the worker. That classifier
# silently passed real drift — missing enum values and wrong column types both
# escaped it — and printed "schema matches" against a drifted database, which is
# the exact failure mode of the `migrate deploy` bookkeeping this guard exists to
# compensate for. A guard that can be wrong in the reassuring direction is worse
# than no guard, so the crude check stands and OUTPOST_ALLOW_SCHEMA_DRIFT is the
# release valve for the skew case.
#
# Fatal rather than a warning because the worker's sync mappings come from the
# database, and one running against a schema it does not match would write wrong
# statuses to Linear. Failing the deploy keeps the previous replica serving.
#
# NOTE: this path exits before `exec node`, so nothing binds /health and the
# platform sees only a healthcheck timeout. The reason is in the deploy log, which
# is the only channel available before the process starts.
echo "[worker] Checking for schema drift..."
set +e
$PRISMA migrate diff \
    --from-schema-datasource "$SCHEMA" \
    --to-schema-datamodel "$SCHEMA" \
    --exit-code
DRIFT_STATUS=$?
set -e

if [ "$DRIFT_STATUS" -eq 2 ]; then
    case "${OUTPOST_ALLOW_SCHEMA_DRIFT:-0}" in
        1 | true | TRUE | True | yes | YES | Yes)
            echo ""
            echo "[worker] WARNING: schema drift detected, but OUTPOST_ALLOW_SCHEMA_DRIFT is set — starting anyway."
            echo "[worker] WARNING: TRACKER_SYNC may write wrong statuses to Linear until this is repaired."
            echo "[worker] WARNING: unset this variable as soon as the schema is fixed."
            ;;
        *)
            echo ""
            echo "[worker] FATAL: the database does not match schema.prisma (see the diff above)."
            echo "[worker] A migration may be recorded as applied without having run."
            echo "[worker] Compare models in schema.prisma against the live tables before redeploying."
            echo "[worker] If this is transient skew from a sibling service mid-rollout, or you need"
            echo "[worker] the worker up during an incident, set OUTPOST_ALLOW_SCHEMA_DRIFT=1."
            exit 1
            ;;
    esac
elif [ "$DRIFT_STATUS" -ne 0 ]; then
    echo ""
    echo "[worker] FATAL: could not check for schema drift — prisma migrate diff exited $DRIFT_STATUS."
    echo "[worker] This is a tool or connectivity failure, NOT confirmed drift: the database"
    echo "[worker] was never successfully compared. Check DATABASE_URL and that the database"
    echo "[worker] is reachable from this container, then redeploy."
    exit 1
fi

echo "[worker] Migrations complete and schema matches. Starting worker..."
exec node apps/worker/dist/index.js
