import { describe, it, expect } from 'vitest';
import type { WorkerHealthStatus } from '@copilotkit/outpost/queue';
import { buildHealthResponse, summarizeBootError, type BootState } from '../health.js';

// Typed as the real contract, so a rename or removal in WorkerHealthStatus fails
// this file instead of leaving it green against a shape /health never serves.
const WORKER_HEALTH: WorkerHealthStatus = {
    running: true,
    activeJobCount: 2,
    activeJobsByType: { AI_RESPONSE: 2 },
    lastPollTime: new Date('2026-08-12T22:00:00.000Z'),
    registeredHandlers: ['AI_RESPONSE', 'TRACKER_SYNC'],
    upSince: new Date('2026-08-12T21:00:00.000Z'),
};

describe('buildHealthResponse', () => {
    it('reports 200 with the worker snapshot once boot is ready', () => {
        const boot: BootState = { phase: 'ready', error: null };

        const { statusCode, body } = buildHealthResponse(boot, WORKER_HEALTH);

        expect(statusCode).toBe(200);
        expect(body).toMatchObject({ status: 'ok', running: true, activeJobCount: 2 });
    });

    // `status` is the envelope's field. Spreading the snapshot over it would let a
    // future WorkerHealthStatus.status redefine "ok" for every probe silently.
    it('keeps its own status field even if the snapshot carries one', () => {
        const boot: BootState = { phase: 'ready', error: null };
        const shadowed = { ...WORKER_HEALTH, status: 'degraded' } as unknown as WorkerHealthStatus;

        const { body } = buildHealthResponse(boot, shadowed);

        expect(body.status).toBe('ok');
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

// /health is unauthenticated, so whatever lands in boot.error is published.
// Prisma's connectivity errors quote the database host, port and user; its
// schema-shape errors name the missing table, which is the whole diagnostic
// point. These pin that only the second kind survives to the wire.
describe('summarizeBootError', () => {
    it('keeps the object name for a missing-table error', () => {
        const error = Object.assign(
            new Error('The table `public.SystemConfig` does not exist in the current database.'),
            { code: 'P2021' },
        );

        expect(summarizeBootError(error)).toContain('SystemConfig');
        expect(summarizeBootError(error)).toContain('P2021');
    });

    it('redacts the host and user out of a connectivity error', () => {
        const error = Object.assign(
            new Error("Can't reach database server at `db.internal.railway.app:5432`"),
            { code: 'P1001' },
        );

        const summary = summarizeBootError(error);

        expect(summary).toContain('P1001');
        expect(summary).not.toContain('db.internal.railway.app');
        expect(summary).not.toContain('5432');
    });

    // The real shape observed from a live boot against an unreachable database:
    // PrismaClientInitializationError, whose errorCode is undefined and whose
    // message quotes host and port. The class name is all that may survive.
    it('redacts a connection failure that carries no code at all', () => {
        const error = new Error("Can't reach database server at `127.0.0.1:59999`");
        error.name = 'PrismaClientInitializationError';

        const summary = summarizeBootError(error);

        expect(summary).toContain('PrismaClientInitializationError');
        expect(summary).not.toContain('127.0.0.1');
    });

    it('redacts credentials out of a plain error', () => {
        const summary = summarizeBootError(new Error('postgres://user:hunter2@host/db refused'));

        expect(summary).not.toContain('hunter2');
        expect(summary).toContain('logs');
    });
});
