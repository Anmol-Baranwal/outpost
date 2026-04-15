/**
 * Tests for the HUBSPOT_SYNC job handler.
 *
 * Mocks HubSpot client, sync service, and Prisma to test the handler
 * in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockSyncAllAccounts = vi.fn();
const mockSyncSingleAccount = vi.fn();

vi.mock('@outpost/db', () => ({
    prisma: {
        account: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock('@outpost/shared', () => ({
    HubSpotClient: class MockHubSpotClient {},
    HubSpotSyncService: class MockHubSpotSyncService {
        syncAllAccounts = mockSyncAllAccounts;
        syncSingleAccount = mockSyncSingleAccount;
    },
}));

// Import after mocks
const { handleHubSpotSync } = await import('../handlers/hubspot-sync.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-job-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

const successReport = {
    created: 3,
    updated: 2,
    skipped: 1,
    errors: [],
    syncedAt: '2026-04-15T00:00:00.000Z',
};

const errorReport = {
    created: 1,
    updated: 0,
    skipped: 0,
    errors: [{ companyId: '101', companyName: 'Bad Co', message: 'API timeout' }],
    syncedAt: '2026-04-15T00:00:00.000Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('handleHubSpotSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Ensure HUBSPOT_API_KEY is set so the client doesn't throw
        process.env.HUBSPOT_API_KEY = 'test-key';
    });

    it('runs full sync when no domain is provided', async () => {
        mockSyncAllAccounts.mockResolvedValue(successReport);

        const result = await handleHubSpotSync({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.created).toBe(3);
        expect(result.data?.updated).toBe(2);
        expect(mockSyncAllAccounts).toHaveBeenCalledOnce();
        expect(mockSyncSingleAccount).not.toHaveBeenCalled();
    });

    it('runs single account sync when domain is provided', async () => {
        mockSyncSingleAccount.mockResolvedValue(successReport);

        const result = await handleHubSpotSync({ domain: 'acme.com' }, makeContext());

        expect(result.success).toBe(true);
        expect(mockSyncSingleAccount).toHaveBeenCalledWith('acme.com');
        expect(mockSyncAllAccounts).not.toHaveBeenCalled();
    });

    it('reports partial success when there are errors but also synced records', async () => {
        mockSyncAllAccounts.mockResolvedValue(errorReport);

        const result = await handleHubSpotSync({}, makeContext());

        // Still considered success because created > 0
        expect(result.success).toBe(true);
        expect(result.error).toContain('1 error');
        expect(result.data?.errorCount).toBe(1);
    });

    it('reports failure when only errors and no synced records', async () => {
        mockSyncAllAccounts.mockResolvedValue({
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [{ companyId: 'N/A', companyName: undefined, message: 'Total failure' }],
            syncedAt: '2026-04-15T00:00:00.000Z',
        });

        const result = await handleHubSpotSync({}, makeContext());

        expect(result.success).toBe(false);
        expect(result.error).toContain('Total failure');
    });

    it('reports progress throughout execution', async () => {
        mockSyncAllAccounts.mockResolvedValue(successReport);

        const ctx = makeContext();
        await handleHubSpotSync({}, ctx);

        expect(ctx.reportProgress).toHaveBeenCalledWith(5);
        expect(ctx.reportProgress).toHaveBeenCalledWith(10);
        expect(ctx.reportProgress).toHaveBeenCalledWith(90);
        expect(ctx.reportProgress).toHaveBeenCalledWith(100);
    });

    it('handles HubSpot client initialization failure', async () => {
        // Remove the API key to trigger initialization failure
        delete process.env.HUBSPOT_API_KEY;

        // Reset module cache and re-mock so HubSpotClient throws on construction
        vi.resetModules();

        vi.doMock('@outpost/db', () => ({
            prisma: {
                account: {
                    findFirst: vi.fn(),
                    create: vi.fn(),
                    update: vi.fn(),
                },
            },
        }));

        vi.doMock('@outpost/shared', () => ({
            HubSpotClient: class ThrowingClient {
                constructor() {
                    throw new Error('API key is required');
                }
            },
            HubSpotSyncService: class MockSyncService {
                syncAllAccounts = mockSyncAllAccounts;
                syncSingleAccount = mockSyncSingleAccount;
            },
        }));

        // Re-import handler so it picks up the new mock
        const { handleHubSpotSync: freshHandler } = await import('../handlers/hubspot-sync.js');

        const result = await freshHandler({}, makeContext());

        expect(result.success).toBe(false);
        expect(result.error).toContain('initialization failed');
    });
});
