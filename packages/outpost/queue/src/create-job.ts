import { prisma } from '@copilotkit/outpost/db';
import { MAX_JOB_ATTEMPTS } from '@copilotkit/outpost/shared';
import type { JobType, JobPayload, CreateJobOptions } from './types.js';

/**
 * Create a new job in the queue.
 *
 * Returns the job ID for tracking. The job will be picked up by the next
 * available worker once its runAt time has passed.
 */
export async function createJob<T extends JobType>(
    type: T,
    payload: JobPayload[T],
    options?: CreateJobOptions,
): Promise<string> {
    const job = await prisma.job.create({
        data: {
            type,
            payload: JSON.parse(JSON.stringify(payload)),
            maxAttempts: options?.maxAttempts ?? MAX_JOB_ATTEMPTS,
            runAt: options?.runAt ?? new Date(),
        },
    });
    return job.id;
}

/**
 * Update the progress of a running job.
 * Progress is a percentage from 0 to 100.
 */
export async function updateJobProgress(jobId: string, percent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    await prisma.job.update({
        where: { id: jobId },
        data: { progress: clamped },
    });
}
