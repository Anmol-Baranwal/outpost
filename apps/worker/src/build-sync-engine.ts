/**
 * Builds the SyncEngine for the TRACKER_SYNC handler. Registers the
 * Linear adapter, using the persisted status-map config (falling back
 * to the hardcoded default when nothing is persisted), only when
 * LINEAR_API_KEY and LINEAR_TEAM_ID are set — absent those, the engine
 * has zero registered adapters and TRACKER_SYNC jobs fail with "Plugin
 * ... is not registered" (retried per the queue's normal retry policy,
 * not silently dropped). GitHub
 * adapter registration is not wired here — it needs an authenticated
 * Octokit instance that currently only exists inside apps/github-app.
 */

import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import {
    loadStatusMap,
    loadPriorityMap,
    loadLabelMapper,
    initializeSyncEngine,
    type SyncEngine,
} from '@copilotkit/outpost/shared';

export async function buildSyncEngine(): Promise<SyncEngine> {
    // Load all three persisted mapping configs (status / priority / label),
    // each falling back to its hardcoded default when nothing is persisted.
    const [statusMap, priorityMap, labelMapper] = await Promise.all([
        loadStatusMap('linear', prisma as never),
        loadPriorityMap('linear', prisma as never),
        loadLabelMapper('linear', prisma as never),
    ]);

    return initializeSyncEngine({
        deps: { prisma: prisma as never, createJob: createJob as never },
        identityDeps: prisma as never,
        statusMapOverride: statusMap,
        priorityMapOverride: priorityMap,
        labelMapperOverride: labelMapper,
    });
}
