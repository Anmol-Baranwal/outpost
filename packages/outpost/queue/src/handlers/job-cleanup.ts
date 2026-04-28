/**
 * JOB_CLEANUP handler.
 *
 * Runs every 24 hours via the scheduler. Prevents unbounded growth of the
 * Job and SyncEvent tables by deleting stale records:
 *   1. COMPLETED jobs older than 7 days
 *   2. DEAD_LETTER jobs older than 30 days
 *   3. SyncEvent records older than 30 days
 *
 * Returns a summary of { completedDeleted, deadLetterDeleted, syncEventsDeleted }.
 */

import { prisma } from '@copilotkit/outpost/db';
import type { JobHandler } from '../types.js';
import { JobType } from '../types.js';

export const handleJobCleanup: JobHandler<typeof JobType.JOB_CLEANUP> = async (
    _payload,
    context,
) => {
    const now = new Date();

    // 7 days ago for completed jobs
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // 30 days ago for dead-letter jobs and sync events
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Delete old COMPLETED jobs
    const completedResult = await prisma.job.deleteMany({
        where: {
            status: 'COMPLETED',
            completedAt: { lt: sevenDaysAgo },
        },
    });
    const completedDeleted = completedResult.count;

    await context.reportProgress(33);

    // 2. Delete old DEAD_LETTER jobs
    const deadLetterResult = await prisma.job.deleteMany({
        where: {
            status: 'DEAD_LETTER',
            updatedAt: { lt: thirtyDaysAgo },
        },
    });
    const deadLetterDeleted = deadLetterResult.count;

    await context.reportProgress(66);

    // 3. Delete old SyncEvent records
    const syncEventsResult = await prisma.syncEvent.deleteMany({
        where: {
            createdAt: { lt: thirtyDaysAgo },
        },
    });
    const syncEventsDeleted = syncEventsResult.count;

    await context.reportProgress(100);

    console.log(
        `[Job Cleanup] Deleted ${completedDeleted} completed jobs, ${deadLetterDeleted} dead-letter jobs, ${syncEventsDeleted} sync events`,
    );

    return {
        success: true,
        data: {
            completedDeleted,
            deadLetterDeleted,
            syncEventsDeleted,
        },
    };
};
