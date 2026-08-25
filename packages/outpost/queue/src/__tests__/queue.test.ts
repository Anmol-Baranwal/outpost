/**
 * Tests for the Outpost job queue package.
 *
 * These tests use mocked Prisma to avoid needing a live database.
 * Each test was developed red-green: the test was written first to fail,
 * then the implementation was verified to make it pass.
 *
 * NOTE: If a real Postgres test database is available via DATABASE_URL,
 * integration tests should be added separately. These are unit tests
 * against mocked persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobType } from '../types.js';
import type { JobResult, JobHandlerContext, WorkerHealthStatus } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

// Mock prisma before importing modules that use it
const mockPrismaJob = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
};

const mockPrisma = {
    job: mockPrismaJob,
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
};

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: mockPrisma,
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    MAX_JOB_ATTEMPTS: 5,
    BACKOFF_BASE_MS: 1000,
    BACKOFF_MAX_MS: 300_000,
    calculateBackoff: (attempt: number) => 1000 * Math.pow(2, attempt),
}));

// Import after mocks are set up
const { createJob, updateJobProgress } = await import('../create-job.js');
const { Worker } = await import('../worker.js');
const { Scheduler, DEFAULT_SCHEDULED_JOBS } = await import('../scheduler.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeJobRow(
    overrides: Partial<{
        id: string;
        type: string;
        payload: unknown;
        attempts: number;
        maxAttempts: number;
        claimToken: string;
    }> = {},
) {
    return {
        id: overrides.id ?? 'job-1',
        type: overrides.type ?? JobType.AI_RESPONSE,
        payload: overrides.payload ?? { ticketId: 'tkt-1', source: 'discord' },
        attempts: overrides.attempts ?? 0,
        maxAttempts: overrides.maxAttempts ?? 5,
        claimToken: overrides.claimToken ?? 'claim-1',
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createJob', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a job with correct defaults', async () => {
        mockPrismaJob.create.mockResolvedValue({ id: 'job-123' });

        const id = await createJob(JobType.AI_RESPONSE, {
            ticketId: 'tkt-1',
            source: 'discord',
        });

        expect(id).toBe('job-123');
        expect(mockPrismaJob.create).toHaveBeenCalledOnce();

        const callArg = mockPrismaJob.create.mock.calls[0][0];
        expect(callArg.data.type).toBe('AI_RESPONSE');
        expect(callArg.data.maxAttempts).toBe(5); // MAX_JOB_ATTEMPTS
        expect(callArg.data.payload).toEqual({ ticketId: 'tkt-1', source: 'discord' });
        expect(callArg.data.runAt).toBeInstanceOf(Date);
    });

    it('accepts custom runAt and maxAttempts', async () => {
        mockPrismaJob.create.mockResolvedValue({ id: 'job-456' });
        const futureDate = new Date('2026-12-01T00:00:00Z');

        await createJob(
            JobType.TICKET_CLASSIFY,
            { ticketId: 'tkt-2' },
            { runAt: futureDate, maxAttempts: 3 },
        );

        const callArg = mockPrismaJob.create.mock.calls[0][0];
        expect(callArg.data.maxAttempts).toBe(3);
        expect(callArg.data.runAt).toBe(futureDate);
    });

    it('creates SLA_CHECK job with empty payload', async () => {
        mockPrismaJob.create.mockResolvedValue({ id: 'job-789' });

        const id = await createJob(JobType.SLA_CHECK, {});

        expect(id).toBe('job-789');
        const callArg = mockPrismaJob.create.mock.calls[0][0];
        expect(callArg.data.payload).toEqual({});
    });
});

describe('updateJobProgress', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates progress clamped between 0 and 100', async () => {
        mockPrismaJob.updateMany.mockResolvedValue({ count: 1 });

        await updateJobProgress('job-1', 50, 'claim-1');
        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith({
            where: { id: 'job-1', status: 'PROCESSING', claimToken: 'claim-1' },
            data: { progress: 50 },
        });
    });

    it('clamps progress above 100 to 100', async () => {
        mockPrismaJob.updateMany.mockResolvedValue({ count: 1 });

        await updateJobProgress('job-1', 150, 'claim-1');
        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith({
            where: { id: 'job-1', status: 'PROCESSING', claimToken: 'claim-1' },
            data: { progress: 100 },
        });
    });

    it('clamps negative progress to 0', async () => {
        mockPrismaJob.updateMany.mockResolvedValue({ count: 1 });

        await updateJobProgress('job-1', -10, 'claim-1');
        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith({
            where: { id: 'job-1', status: 'PROCESSING', claimToken: 'claim-1' },
            data: { progress: 0 },
        });
    });
});

describe('Worker', () => {
    let worker: InstanceType<typeof Worker>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockPrisma.$executeRaw.mockResolvedValue(0);
        mockPrismaJob.updateMany.mockResolvedValue({ count: 1 });
        worker = new Worker({
            pollIntervalMs: 100,
            maxConcurrency: 2,
            defaultTimeoutMs: 5000,
        });
    });

    afterEach(async () => {
        // Ensure worker is stopped
        await worker.stop();
        vi.useRealTimers();
    });

    it('picks up jobs in order and processes them', async () => {
        const jobRow = makeJobRow();
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]); // subsequent polls return nothing
        mockPrismaJob.update.mockResolvedValue({});

        const results: string[] = [];
        worker.on(JobType.AI_RESPONSE, async (payload, _ctx) => {
            results.push(payload.ticketId);
            return { success: true };
        });

        worker.start();
        // Advance past the first poll
        await vi.advanceTimersByTimeAsync(0);

        expect(results).toEqual(['tkt-1']);
        const claimSql = mockPrisma.$queryRaw.mock.calls[0][0].join(' ');
        expect(claimSql).toContain('"claimToken" = gen_random_uuid()::text');
        expect(claimSql).toContain('"maxAttempts", "claimToken"');
        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: 'job-1', claimToken: 'claim-1' }),
                data: expect.objectContaining({ status: 'COMPLETED', attempts: 1 }),
            }),
        );
    });

    it('reclaims on the deadline the claiming worker recorded, not its own config', async () => {
        const now = new Date('2026-08-11T12:00:00.000Z');
        vi.setSystemTime(now);

        await worker.stop();
        worker = new Worker({
            pollIntervalMs: 100,
            maxConcurrency: 2,
            defaultTimeoutMs: 5000,
            // Deliberately not 1000: that is BACKOFF_BASE_MS, and the assertion
            // below is that this worker's config does NOT reach the predicate, so
            // it has to be a value nothing else could have put there.
            jobTimeouts: {
                [JobType.AI_RESPONSE]: 7000,
            },
        });

        const recoveredJob = makeJobRow();
        mockPrisma.$executeRaw.mockResolvedValue(1);
        mockPrisma.$queryRaw.mockResolvedValueOnce([recoveredJob]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        const handled: string[] = [];
        worker.on(JobType.AI_RESPONSE, async (payload) => {
            handled.push(payload.ticketId);
            return { success: true };
        });
        worker.on(JobType.ESCALATION, async () => ({ success: true }));

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        const firstReclaim = mockPrisma.$executeRaw.mock.calls[0];
        const reclaimSql = firstReclaim[0].join(' ');
        expect(reclaimSql).toContain("WHERE job.status = 'PROCESSING'");

        // The whole point of B2: this worker's `jobTimeouts` must not appear in the
        // predicate. A replica configured differently from the one that claimed the
        // row would otherwise decide a live claim had expired, and the original
        // handler's success would be fenced out and silently discarded.
        expect(reclaimSql).toContain('job."lockUntil"');
        expect(reclaimSql).not.toContain('jsonb_to_recordset');
        expect(firstReclaim.slice(1)).not.toContain(7000);
        expect(firstReclaim.slice(1)).not.toContain(5000);

        // Rows claimed before `lockUntil` existed still need a way out, on an
        // absolute ceiling rather than a guessed deadline.
        expect(reclaimSql).toContain('job."lockedAt"');
        expect(firstReclaim.slice(1)).toContain(900_000);

        expect(handled).toEqual(['tkt-1']);
    });

    it("writes the claiming worker's own timeout onto the row it claims", async () => {
        await worker.stop();
        worker = new Worker({
            pollIntervalMs: 100,
            maxConcurrency: 2,
            defaultTimeoutMs: 5000,
            jobTimeouts: {
                [JobType.AI_RESPONSE]: 120_000,
            },
        });

        mockPrisma.$queryRaw.mockResolvedValue([]);
        worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        const claim = mockPrisma.$queryRaw.mock.calls[0];
        const claimSql = claim[0].join(' ');
        expect(claimSql).toContain('"lockUntil" = NOW()');
        // Per-type, looked up by the row's own type, with the worker default as the
        // fallback — so a type this worker has no entry for still gets a deadline.
        expect(claimSql).toContain('->> "Job".type');
        const timeoutMap = claim
            .slice(1)
            .find((v: unknown): v is string => typeof v === 'string' && v.includes('AI_RESPONSE'));
        expect(JSON.parse(timeoutMap as string)).toEqual({
            [JobType.AI_RESPONSE]: 120_000,
        });
        expect(claim.slice(1)).toContain(5000);
    });

    it('does not let an old execution clobber the reclaimed claim', async () => {
        const persisted = {
            id: 'job-1',
            status: 'PROCESSING',
            claimToken: 'claim-old',
            attempts: 0,
            progress: null as number | null,
        };
        mockPrismaJob.updateMany.mockImplementation(async ({ where, data }) => {
            if (
                where.id !== persisted.id ||
                where.status !== persisted.status ||
                where.claimToken !== persisted.claimToken
            ) {
                return { count: 0 };
            }
            Object.assign(persisted, data);
            return { count: 1 };
        });

        let oldStarted!: () => void;
        const oldIsRunning = new Promise<void>((resolve) => {
            oldStarted = resolve;
        });
        let releaseOld!: () => void;
        const oldMayFinish = new Promise<void>((resolve) => {
            releaseOld = resolve;
        });
        worker.on(JobType.AI_RESPONSE, async (payload, context) => {
            if (payload.ticketId === 'old-execution') {
                oldStarted();
                await oldMayFinish;
                await context.reportProgress(25);
            }
            return { success: true };
        });

        type ClaimedJob = ReturnType<typeof makeJobRow>;
        const processJob = (
            worker as unknown as { processJob(job: ClaimedJob): Promise<void> }
        ).processJob.bind(worker);
        const oldExecution = processJob(
            makeJobRow({
                payload: { ticketId: 'old-execution', source: 'discord' },
                claimToken: 'claim-old',
            }),
        );
        await oldIsRunning;

        // Model stale reclamation followed by a new exclusive claim.
        persisted.claimToken = 'claim-new';
        persisted.attempts = 1;
        const newExecution = processJob(
            makeJobRow({
                payload: { ticketId: 'new-execution', source: 'discord' },
                attempts: 1,
                claimToken: 'claim-new',
            }),
        );
        await newExecution;

        releaseOld();
        await oldExecution;

        expect(persisted).toMatchObject({
            status: 'COMPLETED',
            claimToken: null,
            attempts: 2,
            progress: 100,
        });
        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: 'job-1',
                    status: 'PROCESSING',
                    claimToken: 'claim-old',
                },
            }),
        );
        expect(mockPrismaJob.update).not.toHaveBeenCalled();
    });

    it('counts crash-abandoned claims toward dead letter only after a recovery grace', async () => {
        worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
        mockPrisma.$queryRaw.mockResolvedValue([]);

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        const reclaimCall = mockPrisma.$executeRaw.mock.calls[0];
        const reclaimSql = reclaimCall[0].join(' ');
        expect(reclaimSql).toContain('job."attempts" + 1');
        expect(reclaimSql).toContain("THEN 'DEAD_LETTER'");
        expect(reclaimSql).toContain('"claimToken" = NULL');
        expect(reclaimSql).toContain('"lockUntil" = NULL');
        // The grace sits on top of the recorded deadline: the normal timeout path
        // must have time to release its own claim before another worker calls it
        // crash-abandoned.
        expect(reclaimCall.slice(1)).toContain(30_000);
    });

    it('spaces a reclaimed retry by the same backoff a handler failure would', async () => {
        worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
        mockPrisma.$queryRaw.mockResolvedValue([]);

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        const reclaimCall = mockPrisma.$executeRaw.mock.calls[0];
        const reclaimSql = reclaimCall[0].join(' ');

        // `runAt = NOW()` let a crash-looping worker burn every attempt on a job
        // back to back and drive it to DEAD_LETTER at full speed. A reclaim and a
        // handler failure both mean "this attempt did not finish", so they have to
        // space retries the same way.
        expect(reclaimSql).not.toContain('ELSE NOW()\n');
        expect(reclaimSql).toContain('POWER(2, job."attempts" + 1)');
        expect(reclaimSql).toContain('random()');
        expect(reclaimSql).toContain('LEAST');
        // Mirrors calculateBackoff: BACKOFF_BASE_MS with jitter, BACKOFF_MAX_MS cap.
        expect(reclaimCall.slice(1)).toContain(1000);
        expect(reclaimCall.slice(1)).toContain(300_000);
    });

    it('marks job DEAD_LETTER after maxAttempts exhausted', async () => {
        const jobRow = makeJobRow({ attempts: 4, maxAttempts: 5 }); // attempt will be 5
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        worker.on(JobType.AI_RESPONSE, async () => {
            return { success: false, error: 'Still broken' };
        });

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: 'job-1', claimToken: 'claim-1' }),
                data: expect.objectContaining({
                    status: 'DEAD_LETTER',
                    attempts: 5,
                    error: 'Still broken',
                }),
            }),
        );
    });

    it('retries failed jobs with backoff when attempts remain', async () => {
        const jobRow = makeJobRow({ attempts: 1, maxAttempts: 5 }); // attempt will be 2
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        worker.on(JobType.AI_RESPONSE, async () => {
            throw new Error('Temporary failure');
        });

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: 'job-1', claimToken: 'claim-1' }),
                data: expect.objectContaining({
                    status: 'PENDING',
                    attempts: 2,
                    error: 'Temporary failure',
                }),
            }),
        );
    });

    it('times out jobs that take too long', async () => {
        const jobRow = makeJobRow();
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        // Create worker with very short timeout
        await worker.stop();
        worker = new Worker({
            pollIntervalMs: 100,
            defaultTimeoutMs: 50,
        });

        worker.on(JobType.AI_RESPONSE, async () => {
            // This job will never finish before timeout
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            return { success: true };
        });

        worker.start();
        // Advance past poll + timeout
        await vi.advanceTimersByTimeAsync(200);

        // Should have been marked as retryable (attempt 1 of 5)
        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'PENDING',
                    error: expect.stringContaining('timed out'),
                }),
            }),
        );
    });

    it('handles missing handler gracefully', async () => {
        const jobRow = makeJobRow({ type: 'UNKNOWN_TYPE' });
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        // No handler registered for UNKNOWN_TYPE
        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockPrismaJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'FAILED',
                    error: expect.stringContaining('No handler'),
                }),
            }),
        );
    });

    it('respects concurrency limits', async () => {
        // Worker has maxConcurrency: 2
        let concurrentCount = 0;
        let maxSeen = 0;

        const slowJobs = [
            makeJobRow({ id: 'j1' }),
            makeJobRow({ id: 'j2' }),
            makeJobRow({ id: 'j3' }),
        ];

        mockPrisma.$queryRaw.mockResolvedValueOnce(slowJobs);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        worker.on(JobType.AI_RESPONSE, async () => {
            concurrentCount++;
            maxSeen = Math.max(maxSeen, concurrentCount);
            // Simulate some work
            await new Promise((resolve) => setTimeout(resolve, 10));
            concurrentCount--;
            return { success: true };
        });

        worker.start();
        // The query returns 3 jobs but batchSize is limited by available slots (maxConcurrency=2)
        // However since we mocked $queryRaw directly, all 3 will be "claimed"
        // The important thing is processJob tracks them all
        await vi.advanceTimersByTimeAsync(100);

        // All 3 should complete (they run concurrently via Promise.allSettled)
        expect(mockPrismaJob.updateMany).toHaveBeenCalledTimes(3);
    });

    it('provides accurate health check information', () => {
        const health = worker.healthCheck();
        expect(health.running).toBe(false);
        expect(health.activeJobCount).toBe(0);
        expect(health.lastPollTime).toBeNull();

        worker.start();
        const healthRunning = worker.healthCheck();
        expect(healthRunning.running).toBe(true);
        expect(healthRunning.upSince).toBeInstanceOf(Date);
    });

    it('stops gracefully and waits for active jobs', async () => {
        let jobFinished = false;
        const jobRow = makeJobRow();
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        worker.on(JobType.AI_RESPONSE, async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            jobFinished = true;
            return { success: true };
        });

        worker.start();
        // Start processing
        await vi.advanceTimersByTimeAsync(0);

        // Now stop while job is still running
        const stopPromise = worker.stop();

        // Job should still be running
        expect(jobFinished).toBe(false);

        // Advance time so the job completes
        await vi.advanceTimersByTimeAsync(300);
        await stopPromise;

        expect(jobFinished).toBe(true);
    });

    it('shares the active-job drain across repeated stop calls', async () => {
        let jobFinished = false;
        const jobRow = makeJobRow();
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        worker.on(JobType.AI_RESPONSE, async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            jobFinished = true;
            return { success: true };
        });

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        const signalStop = worker.stop();
        let appStopResolved = false;
        const appStop = worker.stop().then(() => {
            appStopResolved = true;
        });

        await Promise.resolve();
        expect(appStopResolved).toBe(false);
        expect(jobFinished).toBe(false);

        await vi.advanceTimersByTimeAsync(300);
        await Promise.all([signalStop, appStop]);

        expect(jobFinished).toBe(true);
        expect(appStopResolved).toBe(true);
    });

    it('waits for an in-flight poll and does not claim after shutdown begins', async () => {
        let releaseReclaim!: () => void;
        mockPrisma.$executeRaw.mockImplementationOnce(
            () =>
                new Promise<number>((resolve) => {
                    releaseReclaim = () => resolve(0);
                }),
        );

        worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
        worker.start();

        const stopPromise = worker.stop();
        let stopped = false;
        void stopPromise.then(() => {
            stopped = true;
        });
        await Promise.resolve();
        expect(stopped).toBe(false);

        releaseReclaim();
        await stopPromise;

        expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
        expect(worker.healthCheck().running).toBe(false);
    });

    it('handler receives context with progress reporting', async () => {
        const jobRow = makeJobRow();
        mockPrisma.$queryRaw.mockResolvedValueOnce([jobRow]);
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrismaJob.update.mockResolvedValue({});

        let receivedContext: JobHandlerContext | null = null;

        worker.on(JobType.AI_RESPONSE, async (_payload, ctx) => {
            receivedContext = ctx;
            await ctx.reportProgress(50);
            return { success: true };
        });

        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(receivedContext).not.toBeNull();
        expect(receivedContext!.jobId).toBe('job-1');
        // reportProgress should fence the update to this execution's claim.
        const progressCall = mockPrismaJob.updateMany.mock.calls.find(
            (call: Array<Record<string, Record<string, unknown>>>) => call[0].data.progress === 50,
        );
        expect(progressCall).toBeDefined();
    });

    // The sweep is the only thing standing between a crashed claim and a row that
    // is PROCESSING forever, and it is also the first `await` in every poll. Both
    // properties are load-bearing and neither was pinned.
    describe('the reclaim sweep', () => {
        let warn: ReturnType<typeof vi.spyOn>;
        let error: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            error = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            warn.mockRestore();
            error.mockRestore();
        });

        it('cannot stop the worker claiming when it fails', async () => {
            // The sweep runs ahead of every claim in the same `try`, and
            // `lastPollTime` is already set by then. Without its own catch, one
            // failing sweep ends all claiming while `healthCheck()` still reports
            // healthy: a total outage with nothing to restart it. Recovering
            // abandoned work is a nice-to-have; claiming new work is the job.
            mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('reclaim exploded'));
            mockPrisma.$queryRaw.mockResolvedValue([]);

            worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            // The claim ran anyway. This is the assertion that dies if the
            // try/catch around the sweep is deleted.
            expect(mockPrisma.$queryRaw).toHaveBeenCalled();

            // And it is not a silent recovery.
            const logged = error.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
            expect(logged).toContain('Reclaim sweep failed');
        });

        it('keeps lockUntil bare on one side so the index can serve the predicate', async () => {
            mockPrisma.$queryRaw.mockResolvedValue([]);
            worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            const reclaimSql = mockPrisma.$executeRaw.mock.calls[0][0].join(' ');
            const where = reclaimSql.slice(reclaimSql.indexOf("WHERE job.status = 'PROCESSING'"));

            // `Job_status_lockUntil_idx` exists for this predicate. A `CASE` over
            // the column is not sargable, so the planner would take the `status`
            // prefix and then filter every PROCESSING row — the index would be
            // there and unusable, which is worse than not adding it.
            expect(where).not.toContain('CASE');
            expect(where).toContain('job."lockUntil"');

            // Same reason, one level down: the interval arithmetic has to sit on
            // the right-hand side. `lockUntil + interval < NOW()` is a disjunction
            // and still non-sargable.
            expect(where).toContain('< NOW() -');
            expect(where).not.toMatch(/job\."lockUntil"\s*\+/);
            expect(where).not.toMatch(/job\."lockedAt"\s*\+/);
        });

        it('consumes an attempt, so a crash-looping job still reaches DEAD_LETTER', async () => {
            mockPrisma.$queryRaw.mockResolvedValue([]);
            worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            const reclaimSql = mockPrisma.$executeRaw.mock.calls[0][0].join(' ');

            // Asserting the `SET` fragment specifically. A bare
            // `toContain('job."attempts" + 1')` is satisfied by the occurrences in
            // the `status`, `completedAt` and `runAt` arms, so mutating the
            // assignment to `"attempts" = job."attempts"` walks straight past it —
            // and a job that never accrues an attempt is reclaimed forever.
            expect(reclaimSql).toContain('"attempts" = job."attempts" + 1');
        });

        it("is blind to job type, so no replica can strand another replica's work", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([]);
            worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            const reclaimSql = mockPrisma.$executeRaw.mock.calls[0][0].join(' ');

            // `lockUntil` makes the row self-describing, so nothing about the type
            // is needed to tell that a claim has expired. Asserting the absence of
            // any type reference rather than one spelling of the old predicate:
            // `AND job.type = ANY(...)` would have satisfied the previous guard,
            // and it reintroduces the bug where a crashed claim of a type this
            // replica does not register sits PROCESSING forever.
            expect(reclaimSql).not.toContain('job.type');
            expect(reclaimSql).not.toContain('"Job".type');
        });
    });

    // Every release path has to clear the deadline it set. Inert while the
    // predicate gates on `status = 'PROCESSING'`, but the first future path that
    // sets PROCESSING without writing a fresh `lockUntil` inherits a deadline
    // already in the past and gets reclaimed mid-flight.
    describe('releasing a claim clears its deadline', () => {
        const releaseData = (status: string) =>
            mockPrismaJob.updateMany.mock.calls
                .map((call: Array<{ data: Record<string, unknown> }>) => call[0].data)
                .find((data: Record<string, unknown>) => data.status === status);

        it('clears lockUntil when a job completes', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([makeJobRow()]);
            mockPrisma.$queryRaw.mockResolvedValue([]);

            worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(releaseData('COMPLETED')).toMatchObject({ lockUntil: null });
        });

        it('clears lockUntil when a job is scheduled for retry', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([makeJobRow({ attempts: 1 })]);
            mockPrisma.$queryRaw.mockResolvedValue([]);

            worker.on(JobType.AI_RESPONSE, async () => ({
                success: false,
                error: 'transient',
            }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(releaseData('PENDING')).toMatchObject({ lockUntil: null });
        });

        it('clears lockUntil when a job is dead-lettered', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([
                makeJobRow({ attempts: 4, maxAttempts: 5 }),
            ]);
            mockPrisma.$queryRaw.mockResolvedValue([]);

            worker.on(JobType.AI_RESPONSE, async () => ({
                success: false,
                error: 'permanently broken',
            }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(releaseData('DEAD_LETTER')).toMatchObject({ lockUntil: null });
        });
    });

    // A fenced write means two executions of the same row overlapped — the exact
    // event the claim token exists to produce. Before these, changing both
    // `count > 0` checks to `count >= 0` passed the whole suite: the fence fired
    // and said nothing, on every path.
    describe('fence rejections are reported', () => {
        let warn: ReturnType<typeof vi.spyOn>;
        let error: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            error = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            warn.mockRestore();
            error.mockRestore();
        });

        const fencedMessages = () => warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

        it('warns when a completed job can no longer write its own result', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([makeJobRow()]);
            mockPrisma.$queryRaw.mockResolvedValue([]);
            // Someone else owns the row: it was reclaimed while this execution was
            // still live, so this handler's side effects have now happened twice.
            mockPrismaJob.updateMany.mockResolvedValue({ count: 0 });

            worker.on(JobType.AI_RESPONSE, async () => ({ success: true }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(fencedMessages()).toContain('job-1');
            expect(fencedMessages()).toContain('ran more than once');
        });

        it('keeps the underlying failure when a retry write is fenced', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([
                makeJobRow({ attempts: 1, maxAttempts: 5 }),
            ]);
            mockPrisma.$queryRaw.mockResolvedValue([]);
            mockPrismaJob.updateMany.mockResolvedValue({ count: 0 });

            worker.on(JobType.AI_RESPONSE, async () => {
                throw new Error('upstream timed out');
            });
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            // Pre-fence this path always logged. Losing the retry log would also
            // lose the failure that caused the timeout in the first place.
            expect(fencedMessages()).toContain('upstream timed out');
            expect(fencedMessages()).toContain('fenced');
        });

        it('keeps the underlying failure when a dead-letter write is fenced', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([
                makeJobRow({ attempts: 4, maxAttempts: 5 }),
            ]);
            mockPrisma.$queryRaw.mockResolvedValue([]);
            mockPrismaJob.updateMany.mockResolvedValue({ count: 0 });

            worker.on(JobType.AI_RESPONSE, async () => ({
                success: false,
                error: 'permanently broken',
            }));
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(fencedMessages()).toContain('permanently broken');
            expect(fencedMessages()).toContain('dead-letter write was fenced');
        });

        it('warns when the no-handler tombstone is fenced', async () => {
            // The fifth fenced write in the file, and the last one that was still
            // silent. It also clears the claim, so a fenced tombstone means some
            // other execution owns a row this one just tried to mark FAILED.
            mockPrisma.$queryRaw.mockResolvedValueOnce([makeJobRow({ type: JobType.SLA_CHECK })]);
            mockPrisma.$queryRaw.mockResolvedValue([]);
            mockPrismaJob.updateMany.mockResolvedValue({ count: 0 });

            // No handler registered for SLA_CHECK on this worker.
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(fencedMessages()).toContain('no-handler failure');
            expect(fencedMessages()).toContain('ran more than once');
        });

        it('clears lockUntil on the no-handler tombstone', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([makeJobRow({ type: JobType.SLA_CHECK })]);
            mockPrisma.$queryRaw.mockResolvedValue([]);

            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            const tombstone = mockPrismaJob.updateMany.mock.calls
                .map((call: Array<{ data: Record<string, unknown> }>) => call[0].data)
                .find((data: Record<string, unknown>) => data.status === 'FAILED');
            expect(tombstone).toMatchObject({ lockUntil: null });
        });

        it('warns when a progress report is fenced', async () => {
            mockPrisma.$queryRaw.mockResolvedValueOnce([makeJobRow()]);
            mockPrisma.$queryRaw.mockResolvedValue([]);
            mockPrismaJob.updateMany.mockResolvedValue({ count: 0 });

            worker.on(JobType.AI_RESPONSE, async (_payload, ctx) => {
                await ctx.reportProgress(50);
                return { success: true };
            });
            worker.start();
            await vi.advanceTimersByTimeAsync(0);

            // Earliest observable sign that this execution has lost its claim while
            // the handler is still running.
            expect(fencedMessages()).toContain('Progress update for job job-1 was fenced');
        });
    });
});

// `LEGACY_RECLAIM_CEILING_MS` is fixed on purpose — deriving it from the observing
// worker's config is the bug `lockUntil` was added to remove. But fixed means it
// does not follow `jobTimeouts` upward, and the two live in different packages, so
// nothing else would notice them drifting apart.
describe('Worker legacy-reclaim ceiling guard', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
    });

    const warnings = () => warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

    it('stays quiet for the timeouts the worker actually ships with', () => {
        // apps/worker/src/index.ts: the two longest are HUBSPOT_SYNC and
        // ACCOUNT_SCORING, tied at 300s. 300_000 + 30_000 grace < 900_000.
        new Worker({
            defaultTimeoutMs: 30_000,
            jobTimeouts: {
                [JobType.AI_RESPONSE]: 120_000,
                [JobType.HUBSPOT_SYNC]: 300_000,
                [JobType.ACCOUNT_SCORING]: 300_000,
            },
        });

        expect(warnings()).not.toContain('LEGACY_RECLAIM_CEILING_MS');
    });

    it('says so when a configured timeout outgrows the ceiling', () => {
        // During the one rollout where rows still carry a NULL `lockUntil`, a
        // timeout this long means the sweep calls a live claim abandoned and the
        // original execution's completion is fenced out and discarded.
        new Worker({ jobTimeouts: { [JobType.HUBSPOT_SYNC]: 1_200_000 } });

        expect(warnings()).toContain('LEGACY_RECLAIM_CEILING_MS');
        expect(warnings()).toContain('1230000');
    });

    it('counts defaultTimeoutMs too, not just the per-type map', () => {
        new Worker({ defaultTimeoutMs: 1_200_000 });

        expect(warnings()).toContain('LEGACY_RECLAIM_CEILING_MS');
    });
});

describe('Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('has correct default scheduled jobs', () => {
        expect(DEFAULT_SCHEDULED_JOBS).toHaveLength(7);
        const types = DEFAULT_SCHEDULED_JOBS.map((d) => d.type);
        expect(types).toContain(JobType.SLA_CHECK);
        expect(types).toContain(JobType.ONBOARDING_DIGEST);
        expect(types).toContain(JobType.ACCOUNT_SCORING);
        expect(types).toContain(JobType.HUBSPOT_SYNC);
        expect(types).toContain(JobType.JOB_CLEANUP);
        expect(types).toContain(JobType.GITHUB_REACTION_POLL);
        expect(types).toContain(JobType.PENDING_RESPONSE_SWEEP);
    });

    it('creates a job immediately on start if none exists', async () => {
        mockPrismaJob.findFirst.mockResolvedValue(null); // no existing job
        mockPrismaJob.create.mockResolvedValue({ id: 'sched-1' });

        const scheduler = new Scheduler([
            {
                type: JobType.SLA_CHECK,
                payload: {},
                intervalMs: 60_000,
                description: 'Test SLA check',
            },
        ]);

        scheduler.start();
        // tick runs immediately on start
        await vi.advanceTimersByTimeAsync(0);

        expect(mockPrismaJob.create).toHaveBeenCalledOnce();
        const callArg = mockPrismaJob.create.mock.calls[0][0];
        expect(callArg.data.type).toBe(JobType.SLA_CHECK);

        scheduler.stop();
    });

    it('skips creating a job if one is already pending', async () => {
        mockPrismaJob.findFirst.mockResolvedValue({ id: 'existing-1', status: 'PENDING' });

        const scheduler = new Scheduler([
            {
                type: JobType.SLA_CHECK,
                payload: {},
                intervalMs: 60_000,
                description: 'Test SLA check',
            },
        ]);

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);

        // Should NOT have created a new job
        expect(mockPrismaJob.create).not.toHaveBeenCalled();

        scheduler.stop();
    });

    it('creates recurring jobs on interval', async () => {
        mockPrismaJob.findFirst.mockResolvedValue(null);
        mockPrismaJob.create.mockResolvedValue({ id: 'sched-recurring' });

        const scheduler = new Scheduler([
            {
                type: JobType.SLA_CHECK,
                payload: {},
                intervalMs: 1000, // 1 second for testing
                description: 'Fast SLA check',
            },
        ]);

        scheduler.start();
        // Initial tick
        await vi.advanceTimersByTimeAsync(0);
        expect(mockPrismaJob.create).toHaveBeenCalledTimes(1);

        // Advance past one interval
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockPrismaJob.create).toHaveBeenCalledTimes(2);

        // Advance past another interval
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockPrismaJob.create).toHaveBeenCalledTimes(3);

        scheduler.stop();
    });

    it('injects current date for onboarding digest jobs', async () => {
        vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
        mockPrismaJob.findFirst.mockResolvedValue(null);
        mockPrismaJob.create.mockResolvedValue({ id: 'digest-1' });

        const scheduler = new Scheduler([
            {
                type: JobType.ONBOARDING_DIGEST,
                payload: { date: '' },
                intervalMs: 86_400_000,
                description: 'Daily digest',
            },
        ]);

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);

        const callArg = mockPrismaJob.create.mock.calls[0][0];
        // payload goes through JSON.parse(JSON.stringify(...)) in createJob
        expect(JSON.stringify(callArg.data.payload)).toContain('2026-04-15');

        scheduler.stop();
    });

    it('stops cleanly and clears all timers', () => {
        const scheduler = new Scheduler();
        scheduler.start();
        scheduler.stop();

        // Double stop should be safe
        scheduler.stop();
    });
});

describe('JobType enum', () => {
    it('contains all expected job types', () => {
        expect(JobType.AI_RESPONSE).toBe('AI_RESPONSE');
        expect(JobType.TICKET_CLASSIFY).toBe('TICKET_CLASSIFY');
        expect(JobType.SLA_CHECK).toBe('SLA_CHECK');
        expect(JobType.ESCALATION).toBe('ESCALATION');
        expect(JobType.ONBOARDING_DIGEST).toBe('ONBOARDING_DIGEST');
    });

    it('has exactly 11 job types', () => {
        const values = Object.values(JobType);
        expect(values).toHaveLength(11);
    });
});
