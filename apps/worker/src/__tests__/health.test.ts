import { describe, it, expect } from 'vitest';
import { buildHealthResponse, type BootState } from '../health.js';

const WORKER_HEALTH = { running: true, activeJobs: 2, pollIntervalMs: 1000 };

describe('buildHealthResponse', () => {
    it('reports 200 with the worker snapshot once boot is ready', () => {
        const boot: BootState = { phase: 'ready', error: null };

        const { statusCode, body } = buildHealthResponse(boot, WORKER_HEALTH);

        expect(statusCode).toBe(200);
        expect(body).toMatchObject({ status: 'ok', running: true, activeJobs: 2 });
    });

    // The regression this pins: the worker used to await the database at module
    // scope, above the health server, so a boot failure exited the process before
    // anything bound the port. Railway could only say "1/1 replicas never became
    // healthy" — indistinguishable from a broken image, and it hid a missing
    // SystemConfig table for nine days. A failed boot must now answer, and the
    // answer must carry the reason.
    it('reports 503 AND the reason when boot failed', () => {
        const boot: BootState = {
            phase: 'failed',
            error: 'The table `public.SystemConfig` does not exist in the current database.',
        };

        const { statusCode, body } = buildHealthResponse(boot, null);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('failed');
        expect(body.error).toContain('SystemConfig');
    });

    it('reports 503 while boot is still in progress', () => {
        const boot: BootState = { phase: 'starting', error: null };

        const { statusCode, body } = buildHealthResponse(boot, null);

        expect(statusCode).toBe(503);
        expect(body).toEqual({ status: 'starting', error: null });
    });

    // A half-booted worker must not be reported healthy just because the phase
    // flag says ready — the snapshot is what proves the worker exists.
    it('does not report 200 when the phase is ready but no worker exists', () => {
        const boot: BootState = { phase: 'ready', error: null };

        const { statusCode, body } = buildHealthResponse(boot, null);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('ready');
    });

    // Fail-fast is retained on purpose: a worker whose sync mappings could not be
    // read must never be routed to, because it would write wrong statuses to
    // Linear. This pins that a failed boot is not quietly downgraded to healthy.
    it('never returns 200 for a failed boot, even with a worker snapshot present', () => {
        const boot: BootState = { phase: 'failed', error: 'connection refused' };

        const { statusCode } = buildHealthResponse(boot, WORKER_HEALTH);

        expect(statusCode).toBe(503);
    });
});
