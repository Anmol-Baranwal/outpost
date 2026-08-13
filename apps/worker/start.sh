#!/bin/sh
set -eu

# These fire only BETWEEN the startup steps below, not during them: POSIX sh defers
# a trap until the running foreground command returns, and the platform signals PID
# 1 only, so `prisma` never receives it either. A SIGTERM arriving mid-migration is
# therefore NOT aborted — the shell waits for prisma to finish, then runs this.
# What that buys is worth having anyway: the script will not fall through to
# `exec node` after an aborted shutdown, and the abort is logged rather than silent.
# Interrupting a migration in flight is deliberately not attempted; a half-applied
# migration is the P3009 state this script exists to diagnose.
trap 'echo "[worker] SIGTERM received between startup steps, aborting" >&2; exit 143' TERM
trap 'echo "[worker] SIGINT received between startup steps, aborting"  >&2; exit 130' INT

# Overridable so CI can execute this script against a stub that returns canned exit
# codes. Nothing previously ran start.sh at all — CI re-implemented the prisma calls
# in bash on ubuntu, which is exactly why a busybox-vs-GNU exit-code difference in
# the timeout handling went unnoticed.
PRISMA="${OUTPOST_PRISMA_CMD:-node /opt/prisma/node_modules/prisma/build/index.js}"
SCHEMA="packages/outpost/db/prisma/schema.prisma"

# The drift check is bounded. Against a black-holing endpoint (a dropped packet
# rather than a refusal) the CLI can hang far past any TCP timeout, and a hang
# produces NO log line at all — indistinguishable from a slow migration and from a
# healthy-but-slow boot, which defeats the point of putting the reason in the log.
#
# `migrate deploy` is deliberately NOT bounded. Killing it mid-migration leaves
# _prisma_migrations holding a row with finished_at = NULL, which is the P3009
# failed-migration state this script exists to diagnose — a bound there would
# manufacture the very condition it reports. Same reasoning as the signal traps
# above: a slow migration is survivable, a half-applied one is not.
STEP_TIMEOUT="${OUTPOST_STARTUP_STEP_TIMEOUT:-120}"
UNBOUNDED=no
case "$STEP_TIMEOUT" in
    '' | *[!0-9]*)
        echo "[worker] NOTE: OUTPOST_STARTUP_STEP_TIMEOUT='${STEP_TIMEOUT}' is not a whole number of seconds; using 120." >&2
        STEP_TIMEOUT=120
        ;;
    0)
        # GNU timeout reads 0 as "no limit"; busybox reads it as "kill immediately",
        # which would SIGKILL the drift check at t=0 and report it as a database
        # failure. Honour the GNU reading, since that is what an operator means.
        echo "[worker] NOTE: OUTPOST_STARTUP_STEP_TIMEOUT=0 — the drift check will run unbounded." >&2
        UNBOUNDED=yes
        ;;
esac

if [ "$UNBOUNDED" = no ] && command -v timeout >/dev/null 2>&1; then
    # -k so a child that traps SIGTERM (the prisma CLI does, for engine cleanup) is
    # still killed: busybox otherwise signals and then waits for it anyway, which
    # means no bound at all. And busybox reports a timeout as 128+SIGTERM = 143,
    # not GNU coreutils' 124 — normalise here so callers can test one value.
    run_step() {
        timeout -k 10 "$STEP_TIMEOUT" "$@"
        _st=$?
        if [ "$_st" -eq 143 ] || [ "$_st" -eq 137 ]; then
            return 124
        fi
        return "$_st"
    }
else
    # Not the deployed path (busybox provides timeout in node:*-alpine), but a
    # missing applet must not fail every startup step closed.
    [ "$UNBOUNDED" = no ] && echo "[worker] NOTE: timeout(1) is unavailable; the drift check will run unbounded." >&2
    run_step() { "$@"; }
fi

# Progress goes to stdout; everything else (NOTE, WARNING, FATAL) to stderr. web
# and worker migrate into the same database and their Railway logs interleave, so
# "something needs attention" has to be machine-distinguishable and not merely
# prefixed. Note this is a two-way split, not three severity levels — an alert rule
# keyed on stderr alone will also catch NOTE lines.
fatal() {
    echo "" >&2
    while [ "$#" -gt 0 ]; do
        echo "[worker] $1" >&2
        shift
    done
}

# Recognised spellings of the incident override. Anything else fails closed, but
# says so — an operator who sets OUTPOST_ALLOW_SCHEMA_DRIFT=on under pressure must
# not get output byte-identical to having never set it at all.
drift_override_set() {
    _drift_value=$(printf '%s' "${OUTPOST_ALLOW_SCHEMA_DRIFT:-0}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]"')
    case "$_drift_value" in
        1 | true | yes | y | on | enabled) return 0 ;;
        '' | 0 | false | no | n | off) return 1 ;;
        *)
            echo "[worker] NOTE: OUTPOST_ALLOW_SCHEMA_DRIFT is set to '${OUTPOST_ALLOW_SCHEMA_DRIFT:-}', which is not recognised." >&2
            echo "[worker] NOTE: use 1, true, yes, or on. Treating it as NOT set." >&2
            return 1
            ;;
    esac
}

echo "[worker] Running database migrations..."
# A migrate deploy failure is far more common than drift and, left to bare `set -e`,
# dies with Prisma's output and no framing — in a script whose whole purpose is
# naming the real cause.
set +e
$PRISMA migrate deploy --schema "$SCHEMA"
DEPLOY_STATUS=$?
set -e

if [ "$DEPLOY_STATUS" -ne 0 ]; then
    fatal "FATAL: prisma migrate deploy failed (see the error above)." \
        "Common causes: a migration recorded as failed in _prisma_migrations (P3009)," \
        "a migration file edited after it was applied (P3006), or an unreachable database." \
        "The worker will not start against a database whose migrations did not apply."
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
# CI now runs this same comparison against a real database on every PR, so the
# repo-side version of that gap fails there rather than here.
#
# `migrate diff --exit-code`: 0 = identical, 2 = they differ, anything else = the
# CLI itself failed. Those last two are different problems and must not share a
# message — a script whose purpose is naming the real cause should not send the
# on-call hunting for drift that was never detected.
#
# ANY difference is fatal, deliberately. An earlier revision classified the diff
# and failed only on missing objects, so a sibling service mid-rollout would not
# block the worker. That classifier silently passed real drift — missing enum
# values and wrong column types both escaped it — and printed "schema matches"
# against a drifted database, which is the exact failure mode of the `migrate
# deploy` bookkeeping this guard compensates for. A guard that can be wrong in the
# reassuring direction is worse than no guard, so the crude check stands and
# OUTPOST_ALLOW_SCHEMA_DRIFT is the release valve for the skew case.
#
# Fatal because the worker's sync mappings come from the database, and one running
# against a schema it does not match would write wrong statuses to Linear. Failing
# the deploy leaves the previously-deployed replica running — note that replica is
# already serving against this same database and was never re-checked, so this
# buys "no NEW bad worker", not "the database is fine".
#
# NOTE: every exit below happens before `exec node`, so nothing binds /health and
# the platform sees only a healthcheck timeout. The deploy log is the sole channel.
SCHEMA_VERIFIED=yes
echo "[worker] Checking for schema drift..."
set +e
run_step $PRISMA migrate diff \
    --from-schema-datasource "$SCHEMA" \
    --to-schema-datamodel "$SCHEMA" \
    --exit-code
DRIFT_STATUS=$?
set -e

if [ "$DRIFT_STATUS" -eq 2 ]; then
    if drift_override_set; then
        echo "[worker] WARNING: schema drift detected, but OUTPOST_ALLOW_SCHEMA_DRIFT is set — starting anyway." >&2
        echo "[worker] WARNING: TRACKER_SYNC may write wrong statuses to Linear until this is repaired." >&2
        echo "[worker] WARNING: unset this variable as soon as the schema is fixed." >&2
        SCHEMA_VERIFIED=no
    else
        fatal "FATAL: the database does not match schema.prisma (migrate diff printed the differences on stdout, above)." \
            "A migration may be recorded as applied without having run." \
            "Compare models in schema.prisma against the live tables before redeploying." \
            "If this is transient skew from a sibling service mid-rollout, or you need the" \
            "worker up during an incident, set OUTPOST_ALLOW_SCHEMA_DRIFT=1."
        exit 1
    fi
elif [ "$DRIFT_STATUS" -ne 0 ]; then
    # The override covers this branch too. A check that could not RUN is a strictly
    # weaker guarantee than one that ran and found drift, so an operator who accepts
    # drift necessarily accepts this. Without it, any CLI-level breakage — a schema
    # the pinned CLI rejects, a missing engine binary, an unreadable /opt/prisma —
    # is an unbreakable crash loop under restartPolicyType="ALWAYS", with no recourse
    # short of a code change and a rebuild. A guard added to unblock deploys must not
    # become the thing that blocks them.
    if [ "$DRIFT_STATUS" -eq 124 ]; then
        reason="the schema-drift check timed out after ${STEP_TIMEOUT}s; the database accepted the connection but never answered"
    else
        reason="prisma migrate diff exited $DRIFT_STATUS without comparing the database"
    fi
    # The override is consulted BEFORE emitting FATAL. Calling fatal() first would
    # page on every successfully-overridden boot, which is exactly what the
    # stdout/stderr split above exists to avoid.
    if drift_override_set; then
        echo "[worker] WARNING: $reason." >&2
        echo "[worker] WARNING: this is NOT confirmed drift — OUTPOST_ALLOW_SCHEMA_DRIFT is set, starting unverified." >&2
        SCHEMA_VERIFIED=no
    else
        fatal "FATAL: $reason." \
            "The database was NEVER COMPARED. This is NOT confirmed drift." \
            "Causes, roughly by likelihood: DATABASE_URL unset or wrong; database unreachable" \
            "from this container; the pinned prisma CLI (apps/worker/Dockerfile) rejecting" \
            "schema.prisma; a missing or unloadable schema engine binary." \
            "To boot without the guard, set OUTPOST_ALLOW_SCHEMA_DRIFT=1."
        exit 1
    fi
fi

# The success line must not claim verification on either override path — one starts
# against known drift, the other against a database that was never compared.
if [ "$SCHEMA_VERIFIED" = yes ]; then
    echo "[worker] Migrations complete and schema verified. Starting worker..."
else
    echo "[worker] Migrations complete; schema NOT verified (override in effect). Starting worker..."
fi
exec node apps/worker/dist/index.js
