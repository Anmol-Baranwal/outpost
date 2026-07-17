import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadStatusMap = vi.fn();
const mockLoadPriorityMap = vi.fn();
const mockLoadLabelMapper = vi.fn();
const mockInitializeSyncEngine = vi.fn();

vi.mock('@copilotkit/outpost/shared', () => ({
    loadStatusMap: (...args: unknown[]) => mockLoadStatusMap(...args),
    loadPriorityMap: (...args: unknown[]) => mockLoadPriorityMap(...args),
    loadLabelMapper: (...args: unknown[]) => mockLoadLabelMapper(...args),
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

    it('loads the Linear status/priority/label maps and passes them into initializeSyncEngine', async () => {
        const fakeStatusMap = { toOutpost: vi.fn() };
        const fakePriorityMap = { toOutpost: vi.fn() };
        const fakeLabelMapper = { toOutpost: vi.fn() };
        const fakeEngine = { getPlugin: vi.fn() };
        mockLoadStatusMap.mockResolvedValue(fakeStatusMap);
        mockLoadPriorityMap.mockResolvedValue(fakePriorityMap);
        mockLoadLabelMapper.mockResolvedValue(fakeLabelMapper);
        mockInitializeSyncEngine.mockReturnValue(fakeEngine);

        const result = await buildSyncEngine();

        expect(mockLoadStatusMap).toHaveBeenCalledWith('linear', prisma);
        expect(mockLoadPriorityMap).toHaveBeenCalledWith('linear', prisma);
        expect(mockLoadLabelMapper).toHaveBeenCalledWith('linear', prisma);
        expect(mockInitializeSyncEngine).toHaveBeenCalledWith({
            deps: { prisma, createJob },
            identityDeps: prisma,
            statusMapOverride: fakeStatusMap,
            priorityMapOverride: fakePriorityMap,
            labelMapperOverride: fakeLabelMapper,
        });
        expect(result).toBe(fakeEngine);
    });
});
