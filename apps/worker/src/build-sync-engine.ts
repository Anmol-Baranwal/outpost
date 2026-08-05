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
    type SyncEngineDeps,
    type StatusMapDb,
    type PriorityMapDb,
    type LabelMapperDb,
    type IdentityMapperDeps,
} from '@copilotkit/outpost/shared';

export async function buildSyncEngine(): Promise<SyncEngine> {
    // Load all three persisted mapping configs (status / priority / label),
    // each falling back to its hardcoded default when nothing is persisted.
    // The casts below are deliberate: each *Db / *Deps type describes only the
    // slice of Prisma its consumer needs, with loose Record<string, unknown>
    // argument shapes, so the real PrismaClient is not assignable in the strict
    // direction. Asserting to the NAMED contract rather than `as never` keeps the
    // intent legible and — unlike `never`, which is assignable to everything —
    // breaks loudly if any of these contracts gains a required member.
    const [statusMap, priorityMap, labelMapper] = await Promise.all([
        loadStatusMap('linear', prisma as unknown as StatusMapDb),
        loadPriorityMap('linear', prisma as unknown as PriorityMapDb),
        loadLabelMapper('linear', prisma as unknown as LabelMapperDb),
    ]);

    return initializeSyncEngine({
        deps: {
            prisma: prisma as unknown as SyncEngineDeps['prisma'],
            createJob: createJob as SyncEngineDeps['createJob'],
        },
        identityDeps: prisma as unknown as IdentityMapperDeps,
        statusMapOverride: statusMap,
        priorityMapOverride: priorityMap,
        labelMapperOverride: labelMapper,
    });
}
