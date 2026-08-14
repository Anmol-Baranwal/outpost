import { describe, it, expect } from 'vitest';
import type { WorkerHealthStatus } from '@copilotkit/outpost/queue';
import {
    buildHealthResponse,
    resolvePort,
    summarizeBootError,
    STALE_POLL_MS,
    type BootState,
} from '../health.js';

const NOW = new Date('2026-08-12T22:00:00.000Z').getTime();

// Typed as the real contract, so a rename or removal in WorkerHealthStatus fails
// this file instead of leaving it green against a shape /health never serves.
const WORKER_HEALTH: WorkerHealthStatus = {
    running: true,
    activeJobCount: 2,
    activeJobsByType: { AI_RESPONSE: 2 },
    lastPollTime: new Date(NOW - 1_000),
    registeredHandlers: ['AI_RESPONSE', 'TRACKER_SYNC'],
    upSince: new Date(NOW - 3_600_000),
};

describe('buildHealthResponse', () => {
    it('reports 200 with the worker snapshot once boot is ready and the worker is polling', () => {
        const { statusCode, body } = buildHealthResponse({ phase: 'ready' }, WORKER_HEALTH, NOW);

        expect(statusCode).toBe(200);
        expect(body).toMatchObject({ status: 'ok', running: true, activeJobCount: 2 });
    });

    // `status` is the envelope's field. Spreading the snapshot over it would let a
    // future WorkerHealthStatus.status redefine "ok" for every probe silently.
    it('keeps its own status field even if the snapshot carries one', () => {
        const shadowed = { ...WORKER_HEALTH, status: 'degraded' } as unknown as WorkerHealthStatus;

        const { body } = buildHealthResponse({ phase: 'ready' }, shadowed, NOW);

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
            error: 'P2021: missing database object `public.SystemConfig`',
        };

        const { statusCode, body } = buildHealthResponse(boot, null, NOW);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('failed');
        expect(body.error).toContain('SystemConfig');
    });

    it('reports 503 with a reason while boot is still in progress', () => {
        const { statusCode, body } = buildHealthResponse({ phase: 'starting' }, null, NOW);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('starting');
        expect(body.error).toBeTruthy();
    });

    // Fail-fast is retained on purpose: a worker whose sync mappings could not be
    // read must never be routed to, because it would write wrong statuses to
    // Linear. This pins that a failed boot is not quietly downgraded to healthy.
    it('never returns 200 for a failed boot, even with a worker snapshot present', () => {
        const boot: BootState = { phase: 'failed', error: 'connection refused' };

        const { statusCode, body } = buildHealthResponse(boot, WORKER_HEALTH, NOW);

        expect(statusCode).toBe(503);
        expect(body.error).toBe('connection refused');
    });

    // The gap that actually reaches production. Worker.stop() sets running=false
    // without exiting the process — including from Worker's OWN signal handlers —
    // so gating the 200 on the snapshot's existence alone answered
    // 200 {"status":"ok","running":false} for a worker processing nothing.
    it('does not report 200 for a worker that has stopped', () => {
        const stopped: WorkerHealthStatus = { ...WORKER_HEALTH, running: false, upSince: null };

        const { statusCode, body } = buildHealthResponse({ phase: 'ready' }, stopped, NOW);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('stopped');
        expect(body.error).toContain('not running');
    });

    // Worker.poll() catches every error and reschedules, so a poll blocked on a
    // hung database call leaves running=true forever with lastPollTime frozen.
    it('does not report 200 for a worker whose poll loop has stalled', () => {
        const stalled: WorkerHealthStatus = {
            ...WORKER_HEALTH,
            lastPollTime: new Date(NOW - STALE_POLL_MS - 1),
        };

        const { statusCode, body } = buildHealthResponse({ phase: 'ready' }, stalled, NOW);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('stalled');
    });

    it('does not report 200 for a worker that has never polled', () => {
        const neverPolled: WorkerHealthStatus = { ...WORKER_HEALTH, lastPollTime: null };

        const { statusCode } = buildHealthResponse({ phase: 'ready' }, neverPolled, NOW);

        expect(statusCode).toBe(503);
    });

    // A half-booted worker must not be reported healthy just because the phase
    // flag says ready — and the 503 must still explain itself rather than
    // answering {"status":"ready","error":null}, which is the reasonless body
    // this endpoint exists to eliminate.
    it('reports 503 with a reason when the phase is ready but no worker exists', () => {
        const { statusCode, body } = buildHealthResponse({ phase: 'ready' }, null, NOW);

        expect(statusCode).toBe(503);
        expect(body.status).toBe('no-worker');
        expect(body.error).toContain('boot sequence');
    });

    it('serves a body that survives JSON serialization', () => {
        const { body } = buildHealthResponse({ phase: 'ready' }, WORKER_HEALTH, NOW);

        expect(() => JSON.stringify(body)).not.toThrow();
        expect(JSON.parse(JSON.stringify(body))).toMatchObject({ status: 'ok', running: true });
    });
});

// /health is unauthenticated, so whatever lands in boot.error is published.
// Prisma's connectivity errors quote the database host, port and user; its
// schema errors arrive as a multi-line blob whose preamble carries an absolute
// container path and a source code frame. Only the object name may survive.
describe('summarizeBootError', () => {
    // The shape Prisma actually throws — not a hand-built single-line message.
    const realisticP2021 = Object.assign(
        new Error(
            'Invalid `prisma.systemConfig.findUnique()` invocation in\n' +
                '/app/packages/outpost/shared/dist/sync/config.js:34:56\n\n' +
                '  31 const existing = await db.systemConfig.findUnique({\n\n' +
                'The table `public.SystemConfig` does not exist in the current database.',
        ),
        { code: 'P2021' },
    );

    it('names the missing object without leaking container paths or the code frame', () => {
        const summary = summarizeBootError(realisticP2021);

        expect(summary).toContain('P2021');
        expect(summary).toContain('public.SystemConfig');
        expect(summary).not.toContain('/app/');
        expect(summary).not.toContain('findUnique');
    });

    it('covers P2022 missing-column drift, not just P2021', () => {
        const error = Object.assign(
            new Error(
                'The column `public.SystemConfig.updatedAt` does not exist in the current database.',
            ),
            { code: 'P2022' },
        );

        expect(summarizeBootError(error)).toContain('P2022');
        expect(summarizeBootError(error)).toContain('SystemConfig.updatedAt');
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

    // PrismaClientInitializationError carries `errorCode`, not `code` — the real
    // shape observed from a live boot against an unreachable database.
    it('reads errorCode as well as code', () => {
        const error = Object.assign(
            new Error('Timed out fetching a new connection from the pool'),
            {
                errorCode: 'P2024',
            },
        );

        expect(summarizeBootError(error)).toContain('P2024');
    });

    it('falls back to the error class when no code is present at all', () => {
        const error = new Error("Can't reach database server at `127.0.0.1:59999`");
        error.name = 'PrismaClientInitializationError';

        const summary = summarizeBootError(error);

        expect(summary).toContain('PrismaClientInitializationError');
        expect(summary).not.toContain('127.0.0.1');
    });

    it('redacts credentials out of a plain error', () => {
        const summary = summarizeBootError(new Error('postgres://user:hunter2@host/db refused'));

        expect(summary).not.toContain('hunter2');
    });

    it('handles thrown non-Error values', () => {
        expect(summarizeBootError('boom')).toBeTruthy();
        expect(summarizeBootError(null)).toBeTruthy();
        expect(summarizeBootError(undefined)).toBeTruthy();
    });

    // A plain object carrying a safe code is the one case the echo branch exists
    // for; String(obj) would render "[object Object]".
    it('reads .message off a non-Error object carrying a safe code', () => {
        const summary = summarizeBootError({
            code: 'P2021',
            message: 'The table `public.SystemConfig` does not exist in the current database.',
        });

        expect(summary).toContain('public.SystemConfig');
        expect(summary).not.toContain('[object Object]');
    });

    it('bounds the length of anything it serves', () => {
        const error = Object.assign(
            new Error(`The table \`${'x'.repeat(5_000)}\` does not exist.`),
            {
                code: 'P2021',
            },
        );

        expect(summarizeBootError(error).length).toBeLessThanOrEqual(200);
    });
});

// An invalid port used to reach server.listen() as NaN, which throws
// ERR_SOCKET_BAD_PORT synchronously at module scope — killing the process before
// anything bound, the exact opaque failure the health server exists to prevent.
describe('resolvePort', () => {
    it('prefers PORT, then HEALTH_PORT, then the default', () => {
        expect(resolvePort({ PORT: '8080', HEALTH_PORT: '3005' })).toMatchObject({
            port: 8080,
            source: 'PORT',
        });
        expect(resolvePort({ HEALTH_PORT: '3005' })).toMatchObject({
            port: 3005,
            source: 'HEALTH_PORT',
        });
        expect(resolvePort({})).toMatchObject({ port: 3003, source: 'default' });
    });

    // The reported trigger: `??` only falls through on null/undefined, so a
    // cleared platform variable arrives as '' and parses to NaN.
    it('falls back with a warning on an empty PORT rather than yielding NaN', () => {
        const resolved = resolvePort({ PORT: '', HEALTH_PORT: '3005' });

        expect(resolved.port).toBe(3005);
        expect(resolved.source).toBe('HEALTH_PORT');
    });

    it('falls back with a warning on a non-numeric or out-of-range PORT', () => {
        for (const bad of ['tcp://host:5432', 'abc', '70000', '-1']) {
            const resolved = resolvePort({ PORT: bad });

            expect(resolved.port).toBe(3003);
            expect(resolved.warning).toContain(bad);
            expect(Number.isInteger(resolved.port)).toBe(true);
        }
    });
});
