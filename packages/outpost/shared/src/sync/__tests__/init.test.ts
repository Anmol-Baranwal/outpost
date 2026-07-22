import { describe, it, expect, vi } from 'vitest';
import { initializeSyncEngine } from '../init.js';
import { StatusMap } from '../status-map.js';
import { PriorityMap } from '../priority-map.js';
import { LabelMapper } from '../label-map.js';
import { TicketStatus, TicketPriority } from '../../types.js';

function makeIdentityDeps() {
    return {
        externalIdentity: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
        },
    };
}

// SyncEngine requires either an injected echoGuard or prisma.syncEvent to
// construct its internal EchoGuard — stub syncEvent so the engine can be
// constructed in these tests.
function makeSyncEngineDeps() {
    return {
        prisma: {
            syncEvent: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
            },
        } as never,
        createJob: vi.fn(),
    };
}

describe('initializeSyncEngine', () => {
    it('registers no adapters when Linear env vars are missing', () => {
        const engine = initializeSyncEngine({
            deps: makeSyncEngineDeps(),
            identityDeps: makeIdentityDeps(),
            env: {},
        });

        expect(engine.getPlugin('linear')).toBeUndefined();
    });

    it('registers the Linear adapter with the default status map when no override is given', () => {
        const engine = initializeSyncEngine({
            deps: makeSyncEngineDeps(),
            identityDeps: makeIdentityDeps(),
            env: { LINEAR_API_KEY: 'key', LINEAR_TEAM_ID: 'team' },
        });

        expect(engine.getPlugin('linear')).toBeDefined();
    });

    it('uses the provided statusMapOverride instead of the hardcoded default', () => {
        const customMap = new StatusMap({ Custom: TicketStatus.WAITING_ON_TEAM });

        const engine = initializeSyncEngine({
            deps: makeSyncEngineDeps(),
            identityDeps: makeIdentityDeps(),
            env: { LINEAR_API_KEY: 'key', LINEAR_TEAM_ID: 'team' },
            statusMapOverride: customMap,
        });

        const plugin = engine.getPlugin('linear');
        expect(plugin).toBeDefined();
        // mapStatusToOutpost is the InternalTracker interface method the adapter
        // delegates to its injected StatusMap
        expect(plugin!.mapStatusToOutpost('Custom')).toBe(TicketStatus.WAITING_ON_TEAM);
    });

    it('uses the provided priorityMapOverride instead of the hardcoded default', () => {
        const customMap = new PriorityMap({ P0: TicketPriority.CRITICAL });

        const engine = initializeSyncEngine({
            deps: makeSyncEngineDeps(),
            identityDeps: makeIdentityDeps(),
            env: { LINEAR_API_KEY: 'key', LINEAR_TEAM_ID: 'team' },
            priorityMapOverride: customMap,
        });

        const plugin = engine.getPlugin('linear');
        expect(plugin).toBeDefined();
        // mapPriorityToOutpost delegates to the injected PriorityMap. It lives on
        // InternalTracker (not the InternalTracker | ExternalTracker union that
        // getPlugin returns), so narrow before asserting.
        const tracker = plugin as unknown as {
            mapPriorityToOutpost(p: string): TicketPriority;
        };
        expect(tracker.mapPriorityToOutpost('P0')).toBe(TicketPriority.CRITICAL);
    });

    it('registers the Linear adapter when a labelMapperOverride is supplied', () => {
        const customMapper = new LabelMapper({
            rules: [{ externalPrefix: 'X-', outpostPrefix: '' }],
        });

        const engine = initializeSyncEngine({
            deps: makeSyncEngineDeps(),
            identityDeps: makeIdentityDeps(),
            env: { LINEAR_API_KEY: 'key', LINEAR_TEAM_ID: 'team' },
            labelMapperOverride: customMapper,
        });

        // The label mapper is only exercised via async pushLabels (GraphQL), so
        // assert the override is accepted and the adapter still registers.
        expect(engine.getPlugin('linear')).toBeDefined();
    });
});
