/**
 * Health payload construction, split out from index.ts so it is testable.
 *
 * index.ts is a top-level-await module with side effects on import (it binds a
 * port and starts polling), so its boot behaviour cannot be exercised directly
 * from a test. This function holds the part worth pinning: an unbooted or failed
 * worker must report 503 WITH a reason, and only a fully booted one reports 200.
 */

import type { WorkerHealthStatus } from '@copilotkit/outpost/queue';

export type BootPhase = 'starting' | 'ready' | 'failed';

export interface BootState {
    phase: BootPhase;
    /** A redacted reason, safe to serve. See {@link summarizeBootError}. */
    error: string | null;
}

export interface HealthResponse {
    statusCode: number;
    body: Record<string, unknown>;
}

/**
 * Prisma error codes whose message names the offending schema object and carries
 * no connection details, so the raw text is safe to put on /health. P2021 is a
 * missing table, P2022 a missing column — exactly the drift class this endpoint
 * exists to make visible, and the part worth reading from a probe.
 */
const SAFE_TO_ECHO_CODES = new Set(['P2021', 'P2022']);

/**
 * Reduce a boot exception to a reason that can be served on /health.
 *
 * /health is unauthenticated, and Prisma's connectivity errors quote the
 * database host, port and user back at you — P1001 is "Can't reach database
 * server at `host:port`", P1000 names the user. Echoing `error.message`
 * verbatim would publish those to anyone who can reach the probe. Only the
 * schema-shape codes keep their message; everything else is reduced to its
 * code, with the full text left to the logs.
 */
export function summarizeBootError(error: unknown): string {
    // Prisma splits this across two properties: PrismaClientKnownRequestError
    // carries `code`, PrismaClientInitializationError carries `errorCode` (often
    // undefined, which is why the class name is the fallback below).
    const raw = (error ?? {}) as { code?: unknown; errorCode?: unknown };
    const code =
        typeof raw.code === 'string'
            ? raw.code
            : typeof raw.errorCode === 'string'
              ? raw.errorCode
              : null;

    if (code && SAFE_TO_ECHO_CODES.has(code)) {
        return `${code}: ${error instanceof Error ? error.message : String(error)}`;
    }

    // Class name and code only. Both are stable, neither quotes the connection.
    const label = [error instanceof Error ? error.name : 'Error', code].filter(Boolean).join(' ');
    return `${label} — see the worker logs for the full error`;
}

/**
 * Build the /health response.
 *
 * `workerHealth` is the worker's own health snapshot, or null when the worker has
 * not been constructed yet. It is passed rather than read so this stays pure.
 *
 * 503 on a non-ready phase is deliberate. An unbooted worker must not be reported
 * healthy — its sync mappings come from the database, and one running against a
 * schema it does not match would write wrong statuses to Linear. The value added
 * over simply exiting is the body: it names the phase and the error, so a probe
 * alone explains the failure. Exiting before binding the port is what made a
 * missing SystemConfig table look identical to a broken image for nine days.
 */
export function buildHealthResponse(
    boot: BootState,
    workerHealth: WorkerHealthStatus | null,
): HealthResponse {
    if (boot.phase === 'ready' && workerHealth) {
        // `status` last on purpose: it is the envelope's own field, and spreading
        // the snapshot over it would let a future WorkerHealthStatus.status
        // silently redefine what "ok" means to every probe.
        return { statusCode: 200, body: { ...workerHealth, status: 'ok' } };
    }

    return { statusCode: 503, body: { status: boot.phase, error: boot.error } };
}
