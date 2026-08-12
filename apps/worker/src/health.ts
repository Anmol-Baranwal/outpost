/**
 * Health payload construction, split out from index.ts so it is testable.
 *
 * index.ts is a top-level-await module with side effects on import (it binds a
 * port and starts polling), so its boot behaviour cannot be exercised directly
 * from a test. This function holds the part worth pinning: an unbooted or failed
 * worker must report 503 WITH a reason, and only a fully booted one reports 200.
 */

export type BootPhase = 'starting' | 'ready' | 'failed';

export interface BootState {
    phase: BootPhase;
    error: string | null;
}

export interface HealthResponse {
    statusCode: number;
    body: Record<string, unknown>;
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
    workerHealth: Record<string, unknown> | null,
): HealthResponse {
    if (boot.phase === 'ready' && workerHealth) {
        return { statusCode: 200, body: { status: 'ok', ...workerHealth } };
    }

    return { statusCode: 503, body: { status: boot.phase, error: boot.error } };
}
