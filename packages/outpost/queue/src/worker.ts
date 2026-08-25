import { prisma } from '@copilotkit/outpost/db';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, calculateBackoff } from '@copilotkit/outpost/shared';
import { updateJobProgress } from './create-job.js';
import type {
    JobType,
    JobHandler,
    JobResult,
    WorkerOptions,
    WorkerHealthStatus,
    JobHandlerContext,
} from './types.js';

const STALE_RECOVERY_GRACE_MS = 30_000;

/**
 * How long a `PROCESSING` row with no `lockUntil` is left alone.
 *
 * Only reachable for rows a pre-`lockUntil` worker claimed, i.e. during the one
 * deploy that rolls this out. We genuinely do not know what deadline those were
 * granted, so the ceiling is a fixed value set well above the largest configured
 * timeout (`HUBSPOT_SYNC` and `ACCOUNT_SCORING`, 300s each) rather than derived
 * from the observing worker's config — that derivation is exactly the bug
 * `lockUntil` exists to remove, so it must not come back through this door.
 *
 * Being fixed means it does not follow `jobTimeouts` upward. A timeout raised
 * past this ceiling would make the legacy branch reclaim live claims for the
 * length of one rollout, so the constructor checks the two against each other
 * and says so rather than letting it pass silently.
 */
const LEGACY_RECLAIM_CEILING_MS = 900_000;

/**
 * Report a fenced write.
 *
 * `count === 0` on any of these updates is the event the claim token exists to
 * produce, and it means two executions of the same row overlapped — so it must
 * never be inferred from the absence of a log. The pre-fence code always logged
 * on these paths; suppressing the log when the fence fires would make the
 * interesting case the quiet one.
 */
function warnIfFenced(
    count: number,
    job: Pick<ClaimedJob, 'id' | 'type' | 'claimToken'>,
    what: string,
): void {
    if (count > 0) return;
    console.warn(
        `[Queue Worker] ${what} write for job ${job.id} (${job.type}) was fenced: ` +
            `claim ${job.claimToken ?? 'none'} no longer owns the row. ` +
            `Another execution holds it, so this job ran more than once.`,
    );
}

interface ClaimedJob {
    id: string;
    type: string;
    payload: unknown;
    attempts: number;
    maxAttempts: number;
    claimToken: string;
}

/**
 * A worker that polls the Postgres job queue and processes jobs using
 * SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
 *
 * Features:
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Per-job-type timeout support
 * - Job progress tracking
 * - Dead letter queue after maxAttempts exhausted
 * - Configurable concurrency (global + per-type pools)
 * - Health check endpoint
 */
export class Worker {
    private handlers = new Map<string, JobHandler<JobType>>();
    private running = false;
    private shuttingDown = false;
    private pollIntervalMs: number;
    private batchSize: number;
    private maxConcurrency: number;
    private concurrencyByType: Partial<Record<string, number>>;
    private jobTimeouts: Partial<Record<JobType, number>>;
    private defaultTimeoutMs: number;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private pollPromise: Promise<void> | null = null;
    private activeJobs = new Set<string>();
    /** Track active job counts per type for per-type concurrency enforcement */
    private activeJobsByType = new Map<string, number>();
    private lastPollTime: Date | null = null;
    private upSince: Date | null = null;
    private shutdownResolve: (() => void) | null = null;
    private stopPromise: Promise<void> | null = null;
    private signalHandlers: { signal: string; handler: () => void }[] = [];

    constructor(options?: WorkerOptions) {
        this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
        this.batchSize = options?.batchSize ?? 10;
        this.maxConcurrency = options?.maxConcurrency ?? 5;
        this.concurrencyByType = (options?.concurrencyByType ?? {}) as Partial<
            Record<string, number>
        >;
        this.jobTimeouts = options?.jobTimeouts ?? {};
        this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30_000;
        this.warnIfLegacyCeilingTooLow();
    }

    /**
     * Say so when a configured timeout outgrows `LEGACY_RECLAIM_CEILING_MS`.
     *
     * The legacy branch only runs against rows claimed before `lockUntil`
     * existed, so this is a one-rollout concern — but during that rollout a
     * timeout above the ceiling means the sweep calls a still-running claim
     * abandoned, and the original execution's completion is then fenced out and
     * discarded. Checked here rather than left to a comment because the ceiling
     * and the timeouts live in different packages, so nothing else would notice
     * them drifting apart. Once every `PROCESSING` row carries a `lockUntil`,
     * the branch is unreachable and this is only advisory.
     */
    private warnIfLegacyCeilingTooLow(): void {
        const configured = Object.values(this.jobTimeouts).filter(
            (ms): ms is number => typeof ms === 'number',
        );
        const longest = Math.max(this.defaultTimeoutMs, ...configured);
        const needed = longest + STALE_RECOVERY_GRACE_MS;
        if (needed <= LEGACY_RECLAIM_CEILING_MS) return;
        console.warn(
            `[Queue Worker] Longest job timeout (${longest}ms) plus the recovery grace ` +
                `(${STALE_RECOVERY_GRACE_MS}ms) exceeds LEGACY_RECLAIM_CEILING_MS ` +
                `(${LEGACY_RECLAIM_CEILING_MS}ms). Rows claimed before "lockUntil" existed ` +
                `can be reclaimed while still running. Raise the ceiling above ${needed}ms.`,
        );
    }

    /**
     * Register a handler for a specific job type.
     */
    on<T extends JobType>(type: T, handler: JobHandler<T>): void {
        this.handlers.set(type, handler as unknown as JobHandler<JobType>);
    }

    /**
     * Start processing jobs.
     * Registers signal handlers for graceful shutdown.
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.shuttingDown = false;
        this.stopPromise = null;
        this.upSince = new Date();
        console.log('[Queue Worker] Started');
        this.registerSignalHandlers();
        this.runPoll();
    }

    /**
     * Stop processing jobs gracefully.
     * Waits for all active jobs to complete before resolving.
     */
    async stop(): Promise<void> {
        // Signal handlers and the worker app can both request shutdown. Share
        // the same drain promise so a second caller cannot observe
        // `running=false`, return early, and disconnect Prisma/exit while the
        // first caller is still waiting for active jobs.
        if (this.stopPromise) return this.stopPromise;
        if (!this.running) return;
        this.shuttingDown = true;
        this.running = false;

        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }

        this.removeSignalHandlers();

        this.stopPromise = (async () => {
            // A poll may be between its running check and its atomic claim. Let
            // that cycle finish before deciding whether the active set is
            // drained, otherwise stop() can resolve just before it claims work.
            await this.pollPromise;

            // Wait for active jobs to finish
            if (this.activeJobs.size > 0) {
                console.log(
                    `[Queue Worker] Waiting for ${this.activeJobs.size} active jobs to complete...`,
                );
                await new Promise<void>((resolve) => {
                    this.shutdownResolve = resolve;
                    // Check immediately in case jobs finished between the check and setting the resolver
                    if (this.activeJobs.size === 0) {
                        this.shutdownResolve = null;
                        resolve();
                    }
                });
            }

            this.upSince = null;
            console.log('[Queue Worker] Stopped');
        })();

        return this.stopPromise;
    }

    /**
     * Return the current health status of the worker.
     */
    healthCheck(): WorkerHealthStatus {
        return {
            running: this.running,
            activeJobCount: this.activeJobs.size,
            activeJobsByType: Object.fromEntries(this.activeJobsByType),
            lastPollTime: this.lastPollTime,
            registeredHandlers: Array.from(this.handlers.keys()),
            upSince: this.upSince,
        };
    }

    private registerSignalHandlers(): void {
        const handler = () => {
            console.log('[Queue Worker] Received shutdown signal');
            this.stop();
        };
        for (const signal of ['SIGTERM', 'SIGINT'] as const) {
            process.on(signal, handler);
            this.signalHandlers.push({ signal, handler });
        }
    }

    private removeSignalHandlers(): void {
        for (const { signal, handler } of this.signalHandlers) {
            process.removeListener(signal, handler);
        }
        this.signalHandlers = [];
    }

    private runPoll(): void {
        const currentPoll = this.poll();
        this.pollPromise = currentPoll;
        void currentPoll.finally(() => {
            if (this.pollPromise === currentPoll) this.pollPromise = null;
        });
    }

    private schedulePoll(delayMs: number): void {
        if (!this.running) return;
        this.pollTimer = setTimeout(() => this.runPoll(), delayMs);
    }

    private async poll(): Promise<void> {
        if (!this.running) return;

        try {
            this.lastPollTime = new Date();
            const availableSlots = this.maxConcurrency - this.activeJobs.size;

            if (availableSlots <= 0) {
                // At capacity, wait and retry
                this.schedulePoll(this.pollIntervalMs);
                return;
            }

            // Isolated on purpose. This sits ahead of every claim in the same try,
            // and `lastPollTime` is already set, so a failing reclaim would stop
            // all claiming while `buildHealthResponse` still reported healthy —
            // a total outage with nothing to restart it. Recovering abandoned work
            // is a nice-to-have; claiming new work is the job.
            try {
                await this.reclaimStaleJobs();
            } catch (error) {
                console.error('[Queue Worker] Reclaim sweep failed, continuing:', error);
            }
            if (!this.running) return;

            const hasPerTypeLimits = Object.keys(this.concurrencyByType).length > 0;
            let processedCount: number;

            if (hasPerTypeLimits) {
                processedCount = await this.claimJobsByType(availableSlots);
            } else {
                processedCount = await this.claimAndProcessJobs(
                    Math.min(availableSlots, this.batchSize),
                );
            }

            // If we processed jobs, poll immediately for more
            const nextPollDelay = processedCount > 0 ? 0 : this.pollIntervalMs;
            this.schedulePoll(nextPollDelay);
        } catch (error) {
            console.error('[Queue Worker] Poll error:', error);
            this.schedulePoll(this.pollIntervalMs);
        }
    }

    /**
     * Return abandoned PROCESSING jobs to the pending queue before claiming work.
     *
     * `lockUntil` is written with the database clock at claim time, so the stale
     * comparison also uses the database clock, and it is the *claiming* worker's
     * deadline rather than a window re-derived here. A recovery grace is still
     * added on top: the normal timeout path must have time to release its own
     * claim before another worker calls it crash-abandoned. A true abandonment
     * consumes an attempt, clears its claim token, and moves toward DEAD_LETTER
     * like every other failed execution — spaced by the same backoff.
     *
     * Deliberately not filtered to types this worker registers. `lockUntil` makes
     * the row self-describing, so there is no longer anything a worker needs to
     * know about a type in order to tell that its claim has expired — and the old
     * type predicate meant a crashed claim of a type this replica does not handle
     * stayed PROCESSING forever, never reclaimed and never dead-lettered.
     *
     * The deadline test is a disjunction rather than a `CASE` over `lockUntil`,
     * and each arm keeps the column bare on the left with the interval arithmetic
     * on the right. Both are required for `Job_status_lockUntil_idx` to be usable:
     * a `CASE` over the column is not a sargable predicate, so the planner would
     * take the `status` prefix and then filter every `PROCESSING` row, and moving
     * the interval onto the column has the same effect one level down.
     */
    private async reclaimStaleJobs(): Promise<void> {
        // `runAt` mirrors `calculateBackoff` in shared/utils.ts — base * 2^attempt
        // plus jitter under a ceiling — because a reclaim and a handler failure
        // both mean "this attempt did not finish, try again later" and must space
        // retries the same way. Setting NOW() here let a crash-looping worker burn
        // every attempt on a job back to back and drive it to DEAD_LETTER at full
        // speed. The attempt number is the one being scheduled, `attempts + 1`,
        // matching `handleFailure`.
        await prisma.$executeRaw`
            UPDATE "Job" AS job
            SET status = CASE
                    WHEN job."attempts" + 1 >= job."maxAttempts"
                    THEN 'DEAD_LETTER'::"JobStatus"
                    ELSE 'PENDING'::"JobStatus"
                END,
                "attempts" = job."attempts" + 1,
                "lockedAt" = NULL,
                "lockUntil" = NULL,
                "claimToken" = NULL,
                progress = NULL,
                error = 'Worker claim was abandoned before completion',
                "completedAt" = CASE
                    WHEN job."attempts" + 1 >= job."maxAttempts" THEN NOW()
                    ELSE NULL
                END,
                "runAt" = CASE
                    WHEN job."attempts" + 1 >= job."maxAttempts" THEN job."runAt"
                    ELSE NOW() + (
                        LEAST(
                            ${BACKOFF_BASE_MS} * POWER(2, job."attempts" + 1)
                                + random() * ${BACKOFF_BASE_MS},
                            ${BACKOFF_MAX_MS}
                        ) * INTERVAL '1 millisecond'
                    )
                END,
                "updatedAt" = NOW()
            WHERE job.status = 'PROCESSING'
            AND (
                (
                    job."lockUntil" IS NOT NULL
                    AND job."lockUntil"
                        < NOW() - (${STALE_RECOVERY_GRACE_MS} * INTERVAL '1 millisecond')
                )
                OR (
                    job."lockUntil" IS NULL
                    AND job."lockedAt"
                        < NOW() - (${LEGACY_RECLAIM_CEILING_MS} * INTERVAL '1 millisecond')
                )
            )
        `;
    }

    /**
     * This worker's per-type claim durations, as a jsonb object for the claim SQL.
     *
     * Written onto the row at claim time so the deadline belongs to the execution
     * that owns the claim. Deriving it at reclaim time from the *observing*
     * worker's config meant a replica on an older revision — one without an entry
     * for a long-running type, so falling back to `defaultTimeoutMs` — would
     * reclaim a claim that was still live, and the original handler's eventual
     * success would then be fenced out and silently discarded while the job ran
     * a second time.
     */
    private timeoutMapJson(): string {
        return JSON.stringify(this.jobTimeouts);
    }

    /**
     * Claim jobs respecting per-type concurrency limits.
     * For each registered job type that has available capacity, claim up to
     * the available slots for that type.
     */
    private async claimJobsByType(globalSlots: number): Promise<number> {
        let totalProcessed = 0;
        let remainingGlobalSlots = globalSlots;

        // Determine which types have capacity
        const typesWithCapacity: Array<{ type: string; available: number }> = [];

        for (const [type] of this.handlers) {
            if (remainingGlobalSlots <= 0) break;

            const typeLimit = this.concurrencyByType[type];
            const activeForType = this.activeJobsByType.get(type) ?? 0;

            if (typeLimit !== undefined) {
                const available = typeLimit - activeForType;
                if (available > 0) {
                    typesWithCapacity.push({
                        type,
                        available: Math.min(available, remainingGlobalSlots),
                    });
                }
            } else {
                // No per-type limit; bound by global slots only
                typesWithCapacity.push({
                    type,
                    available: remainingGlobalSlots,
                });
            }
        }

        // Claim jobs for each type that has capacity
        for (const { type, available } of typesWithCapacity) {
            if (remainingGlobalSlots <= 0) break;

            const limit = Math.min(available, remainingGlobalSlots, this.batchSize);
            const jobs = await this.claimJobsForType(type, limit);

            if (jobs.length > 0) {
                const promises = jobs.map((job) => this.processJob(job));
                await Promise.allSettled(promises);
                totalProcessed += jobs.length;
                remainingGlobalSlots -= jobs.length;
            }
        }

        return totalProcessed;
    }

    /**
     * Claim pending jobs of a specific type using SKIP LOCKED.
     */
    private async claimJobsForType(type: string, limit: number): Promise<Array<ClaimedJob>> {
        return prisma.$queryRaw<Array<ClaimedJob>>`
            UPDATE "Job"
            SET status = 'PROCESSING', "lockedAt" = NOW(),
                "lockUntil" = NOW() + (
                    COALESCE(
                        (${this.timeoutMapJson()}::jsonb ->> "Job".type)::double precision,
                        ${this.defaultTimeoutMs}
                    ) * INTERVAL '1 millisecond'
                ),
                "claimToken" = gen_random_uuid()::text, "updatedAt" = NOW()
            WHERE id IN (
                SELECT id FROM "Job"
                WHERE status = 'PENDING'
                AND type = ${type}
                AND "runAt" <= NOW()
                ORDER BY "runAt" ASC
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, type, payload, attempts, "maxAttempts", "claimToken"
        `;
    }

    private async claimAndProcessJobs(limit: number): Promise<number> {
        // Use raw query with SKIP LOCKED for safe concurrent job processing.
        // This atomically selects and locks pending jobs that are ready to run.
        const jobs = await prisma.$queryRaw<Array<ClaimedJob>>`
            UPDATE "Job"
            SET status = 'PROCESSING', "lockedAt" = NOW(),
                "lockUntil" = NOW() + (
                    COALESCE(
                        (${this.timeoutMapJson()}::jsonb ->> "Job".type)::double precision,
                        ${this.defaultTimeoutMs}
                    ) * INTERVAL '1 millisecond'
                ),
                "claimToken" = gen_random_uuid()::text, "updatedAt" = NOW()
            WHERE id IN (
                SELECT id FROM "Job"
                WHERE status = 'PENDING'
                AND "runAt" <= NOW()
                ORDER BY "runAt" ASC
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, type, payload, attempts, "maxAttempts", "claimToken"
        `;

        // Process jobs concurrently (each tracked in activeJobs)
        const promises = jobs.map((job) => this.processJob(job));
        await Promise.allSettled(promises);

        return jobs.length;
    }

    private async processJob(job: ClaimedJob): Promise<void> {
        this.activeJobs.add(job.id);
        this.activeJobsByType.set(job.type, (this.activeJobsByType.get(job.type) ?? 0) + 1);

        try {
            const handler = this.handlers.get(job.type);

            if (!handler) {
                console.warn(`[Queue Worker] No handler for job type: ${job.type}`);
                const tombstone = await prisma.job.updateMany({
                    where: {
                        id: job.id,
                        status: 'PROCESSING',
                        claimToken: job.claimToken,
                    },
                    data: {
                        status: 'FAILED',
                        error: `No handler registered for job type: ${job.type}`,
                        completedAt: new Date(),
                        lockedAt: null,
                        lockUntil: null,
                        claimToken: null,
                    },
                });
                warnIfFenced(tombstone.count, job, 'no-handler failure');
                return;
            }

            const attempt = job.attempts + 1;
            const timeoutMs = this.jobTimeouts[job.type as JobType] ?? this.defaultTimeoutMs;

            // Build handler context
            const context: JobHandlerContext = {
                jobId: job.id,
                reportProgress: (percent: number) =>
                    updateJobProgress(job.id, percent, job.claimToken),
            };

            try {
                const result = await this.runWithTimeout(
                    handler(job.payload as Record<string, never>, context),
                    timeoutMs,
                );

                if (result.success) {
                    const completion = await prisma.job.updateMany({
                        where: {
                            id: job.id,
                            status: 'PROCESSING',
                            claimToken: job.claimToken,
                        },
                        data: {
                            status: 'COMPLETED',
                            attempts: attempt,
                            progress: 100,
                            completedAt: new Date(),
                            lockedAt: null,
                            lockUntil: null,
                            claimToken: null,
                        },
                    });
                    // The single most important thing this fence can tell us: the
                    // work finished, and the row says someone else owns it. That
                    // means it was reclaimed while still live and is running, or has
                    // already run, a second time. Every external side effect this
                    // handler produced has happened at least twice.
                    warnIfFenced(completion.count, job, 'completion');
                } else {
                    await this.handleFailure(
                        job.id,
                        job.claimToken,
                        attempt,
                        job.maxAttempts,
                        result.error ?? 'Unknown error',
                    );
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await this.handleFailure(
                    job.id,
                    job.claimToken,
                    attempt,
                    job.maxAttempts,
                    errorMessage,
                );
            }
        } finally {
            this.activeJobs.delete(job.id);
            const currentCount = this.activeJobsByType.get(job.type) ?? 1;
            if (currentCount <= 1) {
                this.activeJobsByType.delete(job.type);
            } else {
                this.activeJobsByType.set(job.type, currentCount - 1);
            }
            // If shutting down and no more active jobs, resolve the shutdown promise
            if (this.shuttingDown && this.activeJobs.size === 0 && this.shutdownResolve) {
                this.shutdownResolve();
                this.shutdownResolve = null;
            }
        }
    }

    private async runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () => reject(new Error(`Job timed out after ${timeoutMs}ms`)),
                timeoutMs,
            );
        });

        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }

    private async handleFailure(
        jobId: string,
        claimToken: string,
        attempt: number,
        maxAttempts: number,
        error: string,
    ): Promise<void> {
        if (attempt >= maxAttempts) {
            // Dead letter: job has exhausted all retries
            const result = await prisma.job.updateMany({
                where: { id: jobId, status: 'PROCESSING', claimToken },
                data: {
                    status: 'DEAD_LETTER',
                    attempts: attempt,
                    error,
                    completedAt: new Date(),
                    lockedAt: null,
                    lockUntil: null,
                    claimToken: null,
                },
            });
            if (result.count > 0) {
                console.error(
                    `[Queue Worker] Job ${jobId} moved to dead letter queue after ${attempt} attempts: ${error}`,
                );
            } else {
                // Pre-fence this always logged. Staying silent here would lose both
                // the fence rejection and the failure that caused it.
                console.warn(
                    `[Queue Worker] Job ${jobId} dead-letter write was fenced ` +
                        `(claim ${claimToken ?? 'none'} no longer owns the row); ` +
                        `the failure it was recording was: ${error}`,
                );
            }
        } else {
            // Schedule retry with exponential backoff
            const backoffMs = calculateBackoff(attempt);
            const runAt = new Date(Date.now() + backoffMs);

            const result = await prisma.job.updateMany({
                where: { id: jobId, status: 'PROCESSING', claimToken },
                data: {
                    status: 'PENDING',
                    attempts: attempt,
                    error,
                    runAt,
                    lockedAt: null,
                    lockUntil: null,
                    claimToken: null,
                    progress: null,
                },
            });
            if (result.count > 0) {
                console.warn(
                    `[Queue Worker] Job ${jobId} failed (attempt ${attempt}/${maxAttempts}), ` +
                        `retrying at ${runAt.toISOString()}: ${error}`,
                );
            } else {
                console.warn(
                    `[Queue Worker] Job ${jobId} retry write was fenced ` +
                        `(claim ${claimToken ?? 'none'} no longer owns the row); ` +
                        `the failure it was recording was: ${error}`,
                );
            }
        }
    }
}
