import { prisma } from '@outpost/db';
import { calculateBackoff } from '@outpost/shared';
import type { JobType, JobHandler, JobResult } from './types.js';

interface WorkerOptions {
    /** How often to poll for new jobs, in milliseconds. Default: 1000 */
    pollIntervalMs?: number;
    /** How many jobs to fetch per poll. Default: 10 */
    batchSize?: number;
}

/**
 * A worker that polls the job queue and processes jobs using SKIP LOCKED
 * to ensure exactly-once processing across multiple workers.
 */
export class Worker {
    private handlers = new Map<string, JobHandler<JobType>>();
    private running = false;
    private pollIntervalMs: number;
    private batchSize: number;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options?: WorkerOptions) {
        this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
        this.batchSize = options?.batchSize ?? 10;
    }

    /**
     * Register a handler for a specific job type.
     */
    on<T extends JobType>(type: T, handler: JobHandler<T>): void {
        this.handlers.set(type, handler as JobHandler<JobType>);
    }

    /**
     * Start processing jobs.
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        console.log('[Queue Worker] Started');
        this.poll();
    }

    /**
     * Stop processing jobs gracefully.
     */
    stop(): void {
        this.running = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        console.log('[Queue Worker] Stopped');
    }

    private async poll(): Promise<void> {
        if (!this.running) return;

        try {
            const processedCount = await this.processAvailableJobs();
            // If we processed jobs, poll immediately for more
            const nextPollDelay = processedCount > 0 ? 0 : this.pollIntervalMs;
            this.pollTimer = setTimeout(() => this.poll(), nextPollDelay);
        } catch (error) {
            console.error('[Queue Worker] Poll error:', error);
            this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
        }
    }

    private async processAvailableJobs(): Promise<number> {
        // Use raw query with SKIP LOCKED for safe concurrent job processing.
        // This atomically selects and locks pending jobs that are ready to run.
        const jobs = await prisma.$queryRaw<
            Array<{
                id: string;
                type: string;
                payload: unknown;
                attempts: number;
                maxAttempts: number;
            }>
        >`
            UPDATE "Job"
            SET status = 'PROCESSING', "lockedAt" = NOW(), "updatedAt" = NOW()
            WHERE id IN (
                SELECT id FROM "Job"
                WHERE status = 'PENDING'
                AND "runAt" <= NOW()
                ORDER BY "runAt" ASC
                LIMIT ${this.batchSize}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, type, payload, attempts, "maxAttempts"
        `;

        for (const job of jobs) {
            await this.processJob(job);
        }

        return jobs.length;
    }

    private async processJob(job: {
        id: string;
        type: string;
        payload: unknown;
        attempts: number;
        maxAttempts: number;
    }): Promise<void> {
        const handler = this.handlers.get(job.type);

        if (!handler) {
            console.warn(`[Queue Worker] No handler for job type: ${job.type}`);
            await prisma.job.update({
                where: { id: job.id },
                data: {
                    status: 'FAILED',
                    error: `No handler registered for job type: ${job.type}`,
                    completedAt: new Date(),
                },
            });
            return;
        }

        const attempt = job.attempts + 1;

        try {
            const result: JobResult = await handler(job.payload as Record<string, unknown>);

            if (result.success) {
                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: 'COMPLETED',
                        attempts: attempt,
                        completedAt: new Date(),
                        lockedAt: null,
                    },
                });
            } else {
                await this.handleFailure(job.id, attempt, job.maxAttempts, result.error ?? 'Unknown error');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await this.handleFailure(job.id, attempt, job.maxAttempts, errorMessage);
        }
    }

    private async handleFailure(
        jobId: string,
        attempt: number,
        maxAttempts: number,
        error: string,
    ): Promise<void> {
        if (attempt >= maxAttempts) {
            await prisma.job.update({
                where: { id: jobId },
                data: {
                    status: 'FAILED',
                    attempts: attempt,
                    error,
                    completedAt: new Date(),
                    lockedAt: null,
                },
            });
            console.error(`[Queue Worker] Job ${jobId} failed permanently after ${attempt} attempts: ${error}`);
        } else {
            // Schedule retry with exponential backoff
            const backoffMs = calculateBackoff(attempt);
            const runAt = new Date(Date.now() + backoffMs);

            await prisma.job.update({
                where: { id: jobId },
                data: {
                    status: 'PENDING',
                    attempts: attempt,
                    error,
                    runAt,
                    lockedAt: null,
                },
            });
            console.warn(
                `[Queue Worker] Job ${jobId} failed (attempt ${attempt}/${maxAttempts}), ` +
                `retrying at ${runAt.toISOString()}: ${error}`,
            );
        }
    }
}
