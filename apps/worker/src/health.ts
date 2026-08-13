/**
 * Boot state, health payload construction, and port resolution — split out from
 * index.ts so they are testable.
 *
 * index.ts is a top-level-await module with side effects on import (it binds a
 * port and starts polling), so its boot behaviour cannot be exercised directly
 * from a test. Everything here is pure and pinned by tests: an unbooted, failed,
 * stopped or stalled worker must report 503 WITH a reason, and only a worker
 * that is actually polling reports 200.
 */

import type { WorkerHealthStatus } from '@copilotkit/outpost/queue';

export type BootPhase = 'starting' | 'ready' | 'failed';

/**
 * Discriminated so the failed-without-a-reason state is unrepresentable. A 503
 * carrying `error: null` is the exact signal-quality bug this module exists to
 * remove; making it a type error is cheaper than remembering to assign `error`
 * before `phase` on every future edit.
 */
export type BootState =
    | { phase: 'starting' }
    | { phase: 'ready' }
    | { phase: 'failed'; error: string };

export interface HealthResponse {
    statusCode: number;
    body: Record<string, unknown>;
}

/**
 * Prisma error codes whose failure names a schema object rather than a
 * connection. P2021 is a missing table, P2022 a missing column — the drift class
 * this endpoint exists to surface. Only the object name is echoed, never the
 * message (see summarizeBootError).
 */
const SAFE_TO_ECHO_CODES = new Set(['P2021', 'P2022']);

/** Worker.poll() reschedules every 1s, so a minute of silence means it is wedged. */
export const STALE_POLL_MS = 60_000;

/** Upper bound on any reason string served to an unauthenticated probe. */
const MAX_REASON_LENGTH = 200;

function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (
        typeof error === 'object' &&
        error !== null &&
        typeof (error as { message?: unknown }).message === 'string'
    ) {
        return (error as { message: string }).message;
    }
    return String(error);
}

/**
 * Reduce a boot exception to a reason that can be served on /health.
 *
 * /health is unauthenticated. Prisma's connectivity errors quote the database
 * host, port and user (P1001 names host:port, P1000 names the user), and even
 * the "safe" schema errors arrive as a multi-line blob whose preamble carries
 * an absolute container path and a source code frame:
 *
 *     Invalid `prisma.systemConfig.findUnique()` invocation in
 *     /app/packages/outpost/shared/dist/sync/config.js:34:56
 *       31 const existing = await db.systemConfig.findUnique({
 *     The table `public.SystemConfig` does not exist in the current database.
 *
 * So nothing is echoed verbatim. For the schema codes the backticked object name
 * is lifted out of the final line — that name is the entire diagnostic payload —
 * and everything else degrades to error class plus code, with the full text left
 * to the logs.
 */
export function summarizeBootError(error: unknown): string {
    const raw = (error ?? {}) as { code?: unknown; errorCode?: unknown };
    // PrismaClientKnownRequestError carries `code`; PrismaClientInitializationError
    // carries `errorCode` (frequently undefined, hence the class-name fallback).
    const code =
        typeof raw.code === 'string'
            ? raw.code
            : typeof raw.errorCode === 'string'
              ? raw.errorCode
              : null;

    if (code && SAFE_TO_ECHO_CODES.has(code)) {
        const lastLine = messageOf(error)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1);
        const object = lastLine ? /`([^`]+)`/.exec(lastLine)?.[1] : undefined;
        if (object) {
            return truncate(
                `${code}: missing database object \`${object}\` — the database does not match schema.prisma`,
            );
        }
    }

    // Class name and code only. Both are stable, neither quotes the connection.
    const label = [error instanceof Error ? error.name : 'Error', code].filter(Boolean).join(' ');
    return truncate(`${label} — see the worker logs for the full error`);
}

function truncate(reason: string): string {
    return reason.length <= MAX_REASON_LENGTH
        ? reason
        : `${reason.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/**
 * Resolve the health-server port from the environment.
 *
 * `??` is not enough: an empty or non-numeric PORT (a cleared platform variable,
 * or a reference variable that failed to resolve) parses to NaN, and
 * `server.listen(NaN)` throws ERR_SOCKET_BAD_PORT synchronously at module scope
 * — killing the process before anything binds, which is precisely the opaque
 * "replicas never became healthy" failure this whole module exists to prevent.
 * An invalid value falls back to the default and says so.
 */
export function resolvePort(
    env: { PORT?: string; HEALTH_PORT?: string },
    fallback = 3003,
): { port: number; source: string; warning: string | null } {
    const candidates: Array<[string, string | undefined]> = [
        ['PORT', env.PORT],
        ['HEALTH_PORT', env.HEALTH_PORT],
    ];

    for (const [source, raw] of candidates) {
        if (raw === undefined || raw.trim() === '') continue;
        const parsed = Number.parseInt(raw, 10);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
            return { port: parsed, source, warning: null };
        }
        return {
            port: fallback,
            source: 'default',
            warning: `invalid ${source}="${raw}" (expected an integer 0-65535), falling back to ${fallback}`,
        };
    }

    return { port: fallback, source: 'default', warning: null };
}

/**
 * Build the /health response.
 *
 * `workerHealth` is the worker's own snapshot, or null when the worker has not
 * been constructed. It is passed rather than read so this stays pure.
 *
 * Every non-200 answer carries a reason. The value added over simply exiting is
 * that body: a probe alone explains the failure. Exiting before binding the port
 * is what made a missing SystemConfig table look identical to a broken image for
 * nine days.
 *
 * 200 requires the worker to be *polling*, not merely constructed. Worker.stop()
 * sets running=false without exiting the process, and a poll blocked on a hung
 * database call freezes lastPollTime — both leave a worker that processes
 * nothing while looking alive, which is the honesty gap tracked by #138.
 */
export function buildHealthResponse(
    boot: BootState,
    workerHealth: WorkerHealthStatus | null,
    now: number = Date.now(),
): HealthResponse {
    if (boot.phase === 'failed') {
        return { statusCode: 503, body: { status: 'failed', error: boot.error } };
    }

    if (boot.phase === 'starting') {
        return { statusCode: 503, body: { status: 'starting', error: 'boot has not finished' } };
    }

    if (!workerHealth) {
        return {
            statusCode: 503,
            body: {
                status: 'no-worker',
                error: 'boot reported ready but no worker was constructed — this is a bug in the boot sequence, not a database problem',
            },
        };
    }

    if (!workerHealth.running) {
        return {
            statusCode: 503,
            body: {
                ...workerHealth,
                status: 'stopped',
                error: 'worker is not running — it was stopped without the process exiting',
            },
        };
    }

    const sincePoll = workerHealth.lastPollTime ? now - workerHealth.lastPollTime.getTime() : null;
    if (sincePoll === null || sincePoll > STALE_POLL_MS) {
        return {
            statusCode: 503,
            body: {
                ...workerHealth,
                status: 'stalled',
                error: `worker has not polled for ${sincePoll ?? 'any'}ms — the poll loop is blocked, most likely on a hung database call`,
            },
        };
    }

    // `status` last on purpose: it is the envelope's own field, and spreading the
    // snapshot over it would let a future WorkerHealthStatus.status silently
    // redefine what "ok" means to every probe.
    return { statusCode: 200, body: { ...workerHealth, status: 'ok' } };
}
