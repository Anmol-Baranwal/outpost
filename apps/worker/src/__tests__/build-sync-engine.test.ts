import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadStatusMap = vi.fn();
const mockLoadPriorityMap = vi.fn();
const mockLoadLabelMapper = vi.fn();
const mockInitializeSyncEngine = vi.fn();

// The loaders are stubbed, but singleReadConfigDb is NOT: it comes through from
// the real module, so the "reads the row once" assertion below exercises the
// actual caching implementation rather than a copy of it living in this file.
vi.mock('@copilotkit/outpost/shared', async (importActual) => ({
    ...(await importActual<typeof import('@copilotkit/outpost/shared')>()),
    loadStatusMap: (...args: unknown[]) => mockLoadStatusMap(...args),
    loadPriorityMap: (...args: unknown[]) => mockLoadPriorityMap(...args),
    loadLabelMapper: (...args: unknown[]) => mockLoadLabelMapper(...args),
    initializeSyncEngine: (...args: unknown[]) => mockInitializeSyncEngine(...args),
}));

const mockConfigFindUnique = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        systemConfig: { findUnique: (...args: unknown[]) => mockConfigFindUnique(...args) },
        externalIdentity: {},
    },
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

        // The loaders each receive a db, not `prisma` itself: they now share a
        // read-once facade over it (see singleReadConfigDb). Assert the contract —
        // plugin name plus a usable systemConfig.findUnique — rather than object
        // identity, which was only ever incidental.
        for (const loader of [mockLoadStatusMap, mockLoadPriorityMap, mockLoadLabelMapper]) {
            expect(loader).toHaveBeenCalledTimes(1);
            const [plugin, db] = loader.mock.calls[0];
            expect(plugin).toBe('linear');
            expect(
                typeof (db as { systemConfig: { findUnique: unknown } }).systemConfig.findUnique,
            ).toBe('function');
        }
        expect(mockInitializeSyncEngine).toHaveBeenCalledWith({
            deps: { prisma, createJob },
            identityDeps: prisma,
            statusMapOverride: fakeStatusMap,
            priorityMapOverride: fakePriorityMap,
            labelMapperOverride: fakeLabelMapper,
        });
        expect(result).toBe(fakeEngine);
    });

    // All three loaders read the same SystemConfig row, which meant three
    // identical queries on every worker boot.
    it('reads the mapping config row once, however many loaders ask for it', async () => {
        mockConfigFindUnique.mockResolvedValue({ key: 'sync.mappingConfig', value: '{}' });
        mockInitializeSyncEngine.mockReturnValue({ getPlugin: vi.fn() });

        // Real loaders would call through; here the mocked ones do not, so drive
        // the facade directly with the db each loader was handed.
        mockLoadStatusMap.mockImplementation(
            async (
                _plugin: string,
                db: { systemConfig: { findUnique: (a: unknown) => unknown } },
            ) => db.systemConfig.findUnique({ where: { key: 'sync.mappingConfig' } }),
        );
        mockLoadPriorityMap.mockImplementation(
            async (
                _plugin: string,
                db: { systemConfig: { findUnique: (a: unknown) => unknown } },
            ) => db.systemConfig.findUnique({ where: { key: 'sync.mappingConfig' } }),
        );
        mockLoadLabelMapper.mockImplementation(
            async (
                _plugin: string,
                db: { systemConfig: { findUnique: (a: unknown) => unknown } },
            ) => db.systemConfig.findUnique({ where: { key: 'sync.mappingConfig' } }),
        );

        await buildSyncEngine();

        expect(mockConfigFindUnique).toHaveBeenCalledTimes(1);
    });
});
