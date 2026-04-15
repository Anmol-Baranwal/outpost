import { prisma } from '@outpost/db';
import { MAX_JOB_ATTEMPTS } from '@outpost/shared';
import type { JobType, JobPayload, CreateJobOptions } from './types.js';

/**
 * Create a new job in the queue.
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
