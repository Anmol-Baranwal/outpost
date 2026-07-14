import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadStatusMap = vi.fn();
const mockInitializeSyncEngine = vi.fn();

vi.mock('@copilotkit/outpost/shared', () => ({
    loadStatusMap: (...args: unknown[]) => mockLoadStatusMap(...args),
    initializeSyncEngine: (...args: unknown[]) => mockInitializeSyncEngine(...args),
}));

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: { systemConfig: {}, externalIdentity: {} },
}));

vi.mock('@copilotkit/outpost/queue', () => ({
    createJob: vi.fn(),
}));

import { buildSyncEngine } from '../build-sync-engine.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';

describe('buildSyncEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads the Linear status map and passes it into initializeSyncEngine', async () => {
        const fakeStatusMap = { toOutpost: vi.fn() };
        const fakeEngine = { getPlugin: vi.fn() };
        mockLoadStatusMap.mockResolvedValue(fakeStatusMap);
        mockInitializeSyncEngine.mockReturnValue(fakeEngine);

        const result = await buildSyncEngine();

        expect(mockLoadStatusMap).toHaveBeenCalledWith('linear', prisma);
        expect(mockInitializeSyncEngine).toHaveBeenCalledWith({
            deps: { prisma, createJob },
            identityDeps: prisma,
            statusMapOverride: fakeStatusMap,
        });
        expect(result).toBe(fakeEngine);
    });
});
