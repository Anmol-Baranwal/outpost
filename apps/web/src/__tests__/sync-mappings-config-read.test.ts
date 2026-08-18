/**
 * Read-path behaviour of GET /api/sync/mappings.
 *
 * The endpoint exists partly because its predecessor accepted edits and threw
 * them away. These tests pin that the same failure shape cannot come back on the
 * READ side: a SystemConfig row that exists but is unusable must not be reported
 * as "never configured", because that renders the code defaults as though they
 * were the admin's saved settings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSystemConfigFindUnique = vi.fn();
const mockExternalIdentityFindMany = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        systemConfig: {
            findUnique: (...args: unknown[]) => mockSystemConfigFindUnique(...args),
        },
        externalIdentity: {
            findMany: (...args: unknown[]) => mockExternalIdentityFindMany(...args),
        },
    },
}));

vi.mock('@/lib/require-admin', () => ({
    requireSession: async () => ({ error: null }),
    requireAdmin: async () => ({ error: null }),
}));

// Import after mocks
import { GET } from '@/app/api/sync/mappings/route';

const VALID_CONFIG = {
    statusMappings: {
        linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }],
    },
    priorityMappings: {
        linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
    },
};

describe('GET /api/sync/mappings — persisted config read path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExternalIdentityFindMany.mockResolvedValue([]);
    });

    it('reports defaults as defaults when no row exists', async () => {
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const body = await (await GET()).json();

        expect(body.configSource).toBe('defaults');
        expect(body.configError).toBeUndefined();
    });

    it('serves the persisted config and says so when the row is valid', async () => {
        mockSystemConfigFindUnique.mockResolvedValue({ value: JSON.stringify(VALID_CONFIG) });

        const body = await (await GET()).json();

        expect(body.configSource).toBe('persisted');
        expect(body.statusMappings).toEqual(VALID_CONFIG.statusMappings);
    });

    // Previously identical to "absent": the admin's config appeared to revert
    // with nothing in the logs.
    it('distinguishes an unparseable row from an absent one, and logs it', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSystemConfigFindUnique.mockResolvedValue({ value: '{not json' });

        const body = await (await GET()).json();

        expect(body.configSource).toBe('defaults');
        expect(body.configError).toContain('JSON');
        expect(errorSpy.mock.calls.flat().join(' ')).toContain('sync.mappingConfig');
        errorSpy.mockRestore();
    });

    // A row written by an older version of the code, or hand-edited in the DB,
    // reached the worker unvalidated because the read path only cast.
    //
    // Validated per section: one unusable section must not discard the other, so
    // the good half is still served and the bad half is named.
    it('falls back per section, keeping the valid half and naming the bad one', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSystemConfigFindUnique.mockResolvedValue({
            value: JSON.stringify({
                statusMappings: {
                    linear: [{ externalStatus: 'Done', outpostStatus: 'NOT_A_STATUS' }],
                },
                priorityMappings: VALID_CONFIG.priorityMappings,
            }),
        });

        const body = await (await GET()).json();

        expect(body.invalidSections).toEqual(['statusMappings']);
        // The bad section serves code defaults...
        expect(body.statusMappings).not.toEqual({
            linear: [{ externalStatus: 'Done', outpostStatus: 'NOT_A_STATUS' }],
        });
        // ...while the good one is still the admin's saved config.
        expect(body.priorityMappings).toEqual(VALID_CONFIG.priorityMappings);
        expect(errorSpy.mock.calls.flat().join(' ')).toContain('statusMappings');
        errorSpy.mockRestore();
    });
});
