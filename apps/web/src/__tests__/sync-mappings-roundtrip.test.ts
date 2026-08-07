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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const mockTransaction = vi.fn();
const mockGetServerSession = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        systemConfig: {
            findUnique: (...a: unknown[]) => mockSystemConfigFindUnique(...a),
            upsert: (...a: unknown[]) => mockSystemConfigUpsert(...a),
        },
        externalIdentity: { findMany: (...a: unknown[]) => mockExternalIdentityFindMany(...a) },
        // The PUT path reads and writes in one transaction so a concurrent save cannot
        // drop label rules. The callback receives the same mocked client.
        $transaction: async (fn: (tx: unknown) => unknown) => {
            mockTransaction(fn);
            return fn({
                systemConfig: {
                    findUnique: (...a: unknown[]) => mockSystemConfigFindUnique(...a),
                    upsert: (...a: unknown[]) => mockSystemConfigUpsert(...a),
                },
            });
        },
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

describe('PUT /api/sync/mappings — labelRules preservation and empty-array rejection', () => {
    const VALID_STATUS = { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] };
    const VALID_PRIORITY = { linear: [{ externalPriority: '1', outpostPriority: 'CRITICAL' }] };
    const SAVED_LABEL_RULES = { github: [{ externalPrefix: 'bug', outpostPrefix: 'defect' }] };

    beforeEach(() => {
        vi.clearAllMocks();
        mockExternalIdentityFindMany.mockResolvedValue([]);
        mockSystemConfigUpsert.mockResolvedValue({});
    });

    function put(body: Record<string, unknown>) {
        return PUT(
            new Request('http://localhost:3000/api/sync/mappings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }) as never,
        );
    }

    function persistedValue() {
        return JSON.parse(mockSystemConfigUpsert.mock.calls[0][0].update.value);
    }

    it('carries forward existing labelRules when the PUT omits the key', async () => {
        // The upsert replaces the whole row, so omitting labelRules used to drop
        // previously persisted rules — a silent wipe reachable through a door the
        // `labelRules: {}` rejection did not cover.
        mockSystemConfigFindUnique.mockResolvedValue({
            value: JSON.stringify({
                statusMappings: VALID_STATUS,
                priorityMappings: VALID_PRIORITY,
                labelRules: SAVED_LABEL_RULES,
            }),
        });

        const res = await put({
            statusMappings: VALID_STATUS,
            priorityMappings: VALID_PRIORITY,
        });

        expect(res.status).toBe(200);
        expect(persistedValue().labelRules).toEqual(SAVED_LABEL_RULES);
    });

    it('rejects an empty per-plugin labelRules array, as the sibling validator does', async () => {
        // loadLabelMapper treats [] as "nothing persisted, use defaults", so saving
        // it would show an empty list while the worker kept applying built-in rules.
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const res = await put({
            statusMappings: VALID_STATUS,
            priorityMappings: VALID_PRIORITY,
            labelRules: { linear: [] },
        });

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('still writes an explicitly supplied labelRules value', async () => {
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const res = await put({
            statusMappings: VALID_STATUS,
            priorityMappings: VALID_PRIORITY,
            labelRules: SAVED_LABEL_RULES,
        });

        expect(res.status).toBe(200);
        expect(persistedValue().labelRules).toEqual(SAVED_LABEL_RULES);
    });
});

describe('PUT /api/sync/mappings — atomicity, un-carriable rows, and label validation', () => {
    const VALID_STATUS = { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] };
    const VALID_PRIORITY = { linear: [{ externalPriority: '1', outpostPriority: 'CRITICAL' }] };
    const SAVED_LABEL_RULES = { github: [{ externalPrefix: 'bug', outpostPrefix: 'defect' }] };

    beforeEach(() => {
        vi.clearAllMocks();
        mockExternalIdentityFindMany.mockResolvedValue([]);
        mockSystemConfigUpsert.mockResolvedValue({});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function put(body: Record<string, unknown>) {
        return PUT(
            new Request('http://localhost:3000/api/sync/mappings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }) as never,
        );
    }

    it('carries labelRules forward inside a transaction, not as two statements', async () => {
        // Read-then-write as separate statements lets a concurrent PUT land between them
        // and lose its rules. Pin that both happen through $transaction.
        mockSystemConfigFindUnique.mockResolvedValue({
            value: JSON.stringify({
                statusMappings: VALID_STATUS,
                priorityMappings: VALID_PRIORITY,
                labelRules: SAVED_LABEL_RULES,
            }),
        });

        const res = await put({ statusMappings: VALID_STATUS, priorityMappings: VALID_PRIORITY });

        expect(res.status).toBe(200);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        const persisted = JSON.parse(mockSystemConfigUpsert.mock.calls[0][0].update.value);
        expect(persisted.labelRules).toEqual(SAVED_LABEL_RULES);
    });

    it('says so when existing labelRules are unusable and cannot be carried', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSystemConfigFindUnique.mockResolvedValue({
            value: JSON.stringify({
                statusMappings: VALID_STATUS,
                priorityMappings: VALID_PRIORITY,
                labelRules: { linear: 'not-an-array' },
            }),
        });

        const res = await put({ statusMappings: VALID_STATUS, priorityMappings: VALID_PRIORITY });

        expect(res.status).toBe(200);
        const persisted = JSON.parse(mockSystemConfigUpsert.mock.calls[0][0].update.value);
        // Unusable rules are dropped rather than persisted...
        expect(persisted.labelRules).toBeUndefined();
        // ...but the drop is reported, so it is not silent.
        expect(errorSpy.mock.calls.flat().join(' ')).toContain('labelRules');
    });

    it('returns the persisted config so the client can store what was actually saved', async () => {
        mockSystemConfigFindUnique.mockResolvedValue({
            value: JSON.stringify({
                statusMappings: VALID_STATUS,
                priorityMappings: VALID_PRIORITY,
                labelRules: SAVED_LABEL_RULES,
            }),
        });

        const body = await (
            await put({ statusMappings: VALID_STATUS, priorityMappings: VALID_PRIORITY })
        ).json();

        // The request omitted labelRules; the response must still show them, otherwise the
        // dashboard drops rules that are saved.
        expect(body.labelRules).toEqual(SAVED_LABEL_RULES);
    });

    it('rejects a non-string label on a priority entry', async () => {
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const res = await put({
            statusMappings: VALID_STATUS,
            priorityMappings: {
                linear: [{ externalPriority: '1', outpostPriority: 'CRITICAL', label: 42 }],
            },
        });

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('accepts a string label', async () => {
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const res = await put({
            statusMappings: VALID_STATUS,
            priorityMappings: {
                linear: [{ externalPriority: '1', outpostPriority: 'CRITICAL', label: 'Urgent' }],
            },
        });

        expect(res.status).toBe(200);
    });
});
