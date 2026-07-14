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
import { loadStatusMap, initializeSyncEngine, type SyncEngine } from '@copilotkit/outpost/shared';

export async function buildSyncEngine(): Promise<SyncEngine> {
    const statusMap = await loadStatusMap('linear', prisma as never);

    return initializeSyncEngine({
        deps: { prisma: prisma as never, createJob: createJob as never },
        identityDeps: prisma as never,
        statusMapOverride: statusMap,
    });
}
