/**
 * Round-trip: GET the dashboard defaults, PUT them straight back, then load them
 * through the same functions the worker uses.
 *
 * This is the structural guard against a whole class of bug. The dashboard PUTs
 * back exactly what GET served, so any value in `externalStatus`/`externalPriority`
 * that is cosmetic rather than the adapter's real lookup key becomes a persisted
 * key that can never match — and the failure is silent, because the loaders fall
 * back to defaults and every inbound value lands on the fallback priority.
 *
 * That is exactly what shipped: the Linear priority defaults read '0 (None)'..
 * '4 (Low)' while LinearAdapter maps with String(data.priority) -> '0'..'4'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TicketPriority, TicketStatus } from '@copilotkit/outpost/shared';
import {
    loadStatusMap,
    loadPriorityMap,
    loadLabelMapper,
    createLinearStatusMap,
    createLinearPriorityMap,
    createGitHubLabelMapper,
} from '@copilotkit/outpost/shared';

const mockSystemConfigFindUnique = vi.fn();
const mockSystemConfigUpsert = vi.fn();
const mockExternalIdentityFindMany = vi.fn();
const mockGetServerSession = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        systemConfig: {
            findUnique: (...a: unknown[]) => mockSystemConfigFindUnique(...a),
            upsert: (...a: unknown[]) => mockSystemConfigUpsert(...a),
        },
        externalIdentity: { findMany: (...a: unknown[]) => mockExternalIdentityFindMany(...a) },
    },
}));

vi.mock('@/lib/require-admin', () => ({
    requireSession: async () => ({ error: null }),
    requireAdmin: async () => ({ error: null }),
}));

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => mockGetServerSession(...a) }));

import { GET, PUT } from '@/app/api/sync/mappings/route';

/** The db shape the loaders need, backed by whatever the PUT persisted. */
function dbServing(value: string) {
    return { systemConfig: { findUnique: async () => ({ key: 'sync.mappingConfig', value }) } };
}

describe('mappings round-trip: GET defaults -> PUT -> load as the worker does', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExternalIdentityFindMany.mockResolvedValue([]);
        mockSystemConfigFindUnique.mockResolvedValue(null); // GET serves code defaults
        mockSystemConfigUpsert.mockImplementation(async (args: { create: { value: string } }) => ({
            key: 'sync.mappingConfig',
            value: args.create.value,
        }));
    });

    async function roundTrip() {
        const served = await (await GET()).json();

        const res = await PUT(
            new Request('http://localhost:3000/api/sync/mappings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    statusMappings: served.statusMappings,
                    priorityMappings: served.priorityMappings,
                    labelRules: served.labelRules,
                }),
            }) as never,
        );
        expect(res.status).toBe(200);

        const persistedValue = mockSystemConfigUpsert.mock.calls[0][0].create.value as string;
        return { served, db: dbServing(persistedValue) };
    }

    it('accepts its own defaults', async () => {
        await roundTrip();
    });

    // The blocker: a saved priority map must still match what LinearAdapter sends.
    it('produces a Linear priority map equivalent to the factory default', async () => {
        const { db } = await roundTrip();

        const loaded = await loadPriorityMap('linear', db as never);
        const factory = createLinearPriorityMap();

        for (const raw of ['0', '1', '2', '3', '4']) {
            expect(loaded.toOutpost(raw)).toBe(factory.toOutpost(raw));
        }
        // And specifically not everything collapsing onto the fallback.
        expect(loaded.toOutpost('1')).toBe(TicketPriority.CRITICAL);
        expect(loaded.toOutpost('4')).toBe(TicketPriority.LOW);
    });

    it('produces a Linear status map equivalent to the factory default', async () => {
        const { db } = await roundTrip();

        const loaded = await loadStatusMap('linear', db as never);
        const factory = createLinearStatusMap();

        for (const state of ['Triage', 'Backlog', 'Todo', 'In Progress', 'Done', 'Canceled']) {
            expect(loaded.toOutpost(state)).toBe(factory.toOutpost(state));
        }
        expect(loaded.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
    });

    // The exclude drop: rebuilding from persisted rules must not lose the
    // factory's wontfix/duplicate/invalid filtering.
    it('keeps GitHub label exclusions after a save', async () => {
        const { db } = await roundTrip();

        const loaded = await loadLabelMapper('github', db as never);
        const factory = createGitHubLabelMapper();

        expect(loaded.toOutpost(['wontfix', 'bug'])).toEqual(factory.toOutpost(['wontfix', 'bug']));
        expect(loaded.toOutpost(['wontfix'])).toEqual([]);
    });
});
