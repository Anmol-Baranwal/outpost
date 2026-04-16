/**
 * Tests for the HubSpot sync service.
 *
 * Uses mock HubSpotClient and AccountStore to test sync logic:
 * creating new accounts, updating existing ones, skipping companies
 * without domains, and handling API errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HubSpotSyncService } from '../hubspot-sync.js';
import type { AccountStore, ExistingAccount } from '../hubspot-sync.js';
import type { HubSpotClient, HubSpotCompany } from '../hubspot.js';

// ─── Mock Helpers ───────────────────────────────────────────────────────────

function makeCompany(overrides: Partial<HubSpotCompany> = {}): HubSpotCompany {
    return {
        id: '101',
        properties: {
            name: 'Acme Corp',
            domain: 'acme.com',
            amount: '50000',
            closedate: '2026-06-15T00:00:00Z',
            hubspot_owner_id: '42',
        },
        ...overrides,
    };
}

function makeExistingAccount(overrides: Partial<ExistingAccount> = {}): ExistingAccount {
    return {
        id: 'acc-1',
        name: 'Acme Corp',
        domain: 'acme.com',
        acv: 40000,
        closeDate: new Date('2026-01-01'),
        owner: 'Old Owner',
        ...overrides,
    };
}

function createMockClient(): {
    mock: Record<string, ReturnType<typeof vi.fn>>;
    client: HubSpotClient;
} {
    const mock = {
        getCompanies: vi.fn(),
        getCompanyByDomain: vi.fn(),
        syncCompanyToAccount: vi.fn(),
    };

    return {
        mock,
        client: mock as unknown as HubSpotClient,
    };
}

function createMockStore(): {
    mock: Record<string, ReturnType<typeof vi.fn>>;
    store: AccountStore;
} {
    const mock = {
        findByDomain: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    };

    return {
        mock,
        store: mock as unknown as AccountStore,
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('HubSpotSyncService', () => {
    let clientMock: ReturnType<typeof createMockClient>;
    let storeMock: ReturnType<typeof createMockStore>;
    let service: HubSpotSyncService;

    beforeEach(() => {
        vi.clearAllMocks();
        clientMock = createMockClient();
        storeMock = createMockStore();
        service = new HubSpotSyncService(clientMock.client, storeMock.store);

        // Default: syncCompanyToAccount returns mapped data
        clientMock.mock.syncCompanyToAccount.mockImplementation(
            async (company: HubSpotCompany) => ({
                name: company.properties.name ?? 'Unknown',
                domain: company.properties.domain ?? null,
                acv: company.properties.amount ? parseFloat(company.properties.amount) : null,
                closeDate: company.properties.closedate
                    ? new Date(company.properties.closedate)
                    : null,
                owner: null,
            }),
        );
    });

    describe('syncAllAccounts', () => {
        it('creates new accounts for companies not in the store', async () => {
            clientMock.mock.getCompanies.mockResolvedValue([makeCompany()]);
            storeMock.mock.findByDomain.mockResolvedValue(null);
            storeMock.mock.create.mockResolvedValue(undefined);

            const report = await service.syncAllAccounts();

            expect(report.created).toBe(1);
            expect(report.updated).toBe(0);
            expect(report.skipped).toBe(0);
            expect(report.errors).toHaveLength(0);
            expect(storeMock.mock.create).toHaveBeenCalledOnce();
        });

        it('updates existing accounts with new ACV, closeDate, and owner', async () => {
            const existing = makeExistingAccount();
            clientMock.mock.getCompanies.mockResolvedValue([makeCompany()]);
            storeMock.mock.findByDomain.mockResolvedValue(existing);
            storeMock.mock.update.mockResolvedValue(undefined);

            const report = await service.syncAllAccounts();

            expect(report.created).toBe(0);
            expect(report.updated).toBe(1);
            expect(storeMock.mock.update).toHaveBeenCalledWith(
                'acc-1',
                expect.objectContaining({
                    acv: 50000,
                }),
            );
        });

        it('skips companies without a domain', async () => {
            const noDomainCompany = makeCompany({
                properties: {
                    name: 'No Domain Co',
                    domain: undefined,
                    amount: '10000',
                },
            });
            clientMock.mock.getCompanies.mockResolvedValue([noDomainCompany]);
            clientMock.mock.syncCompanyToAccount.mockResolvedValue({
                name: 'No Domain Co',
                domain: null,
                acv: 10000,
                closeDate: null,
                owner: null,
            });

            const report = await service.syncAllAccounts();

            expect(report.skipped).toBe(1);
            expect(report.created).toBe(0);
            expect(report.updated).toBe(0);
            expect(storeMock.mock.findByDomain).not.toHaveBeenCalled();
        });

        it('handles API errors when fetching companies', async () => {
            clientMock.mock.getCompanies.mockRejectedValue(
                new Error('HubSpot API rate limit exceeded'),
            );

            const report = await service.syncAllAccounts();

            expect(report.errors).toHaveLength(1);
            expect(report.errors[0].message).toContain('rate limit');
        });

        it('handles per-company errors without stopping the sync', async () => {
            clientMock.mock.getCompanies.mockResolvedValue([
                makeCompany({ id: '1' }),
                makeCompany({ id: '2' }),
            ]);
            // First company succeeds, second throws
            storeMock.mock.findByDomain
                .mockResolvedValueOnce(null)
                .mockRejectedValueOnce(new Error('DB connection lost'));
            storeMock.mock.create.mockResolvedValue(undefined);

            const report = await service.syncAllAccounts();

            expect(report.created).toBe(1);
            expect(report.errors).toHaveLength(1);
            expect(report.errors[0].companyId).toBe('2');
        });

        it('processes multiple companies correctly', async () => {
            clientMock.mock.getCompanies.mockResolvedValue([
                makeCompany({ id: '1', properties: { name: 'Co A', domain: 'a.com', amount: '100' } }),
                makeCompany({ id: '2', properties: { name: 'Co B', domain: 'b.com', amount: '200' } }),
                makeCompany({ id: '3', properties: { name: 'Co C', domain: undefined } }),
            ]);
            // Co A is new, Co B exists, Co C has no domain
            storeMock.mock.findByDomain
                .mockResolvedValueOnce(null) // Co A
                .mockResolvedValueOnce(makeExistingAccount({ domain: 'b.com' })); // Co B
            storeMock.mock.create.mockResolvedValue(undefined);
            storeMock.mock.update.mockResolvedValue(undefined);

            // Override syncCompanyToAccount for the no-domain company
            clientMock.mock.syncCompanyToAccount
                .mockResolvedValueOnce({ name: 'Co A', domain: 'a.com', acv: 100, closeDate: null, owner: null })
                .mockResolvedValueOnce({ name: 'Co B', domain: 'b.com', acv: 200, closeDate: null, owner: null })
                .mockResolvedValueOnce({ name: 'Co C', domain: null, acv: null, closeDate: null, owner: null });

            const report = await service.syncAllAccounts();

            expect(report.created).toBe(1);
            expect(report.updated).toBe(1);
            expect(report.skipped).toBe(1);
            expect(report.errors).toHaveLength(0);
        });

        it('returns a valid syncedAt timestamp', async () => {
            clientMock.mock.getCompanies.mockResolvedValue([]);

            const before = new Date().toISOString();
            const report = await service.syncAllAccounts();
            const after = new Date().toISOString();

            expect(report.syncedAt >= before).toBe(true);
            expect(report.syncedAt <= after).toBe(true);
        });
    });

    describe('syncSingleAccount', () => {
        it('syncs a single account by domain', async () => {
            clientMock.mock.getCompanyByDomain.mockResolvedValue(makeCompany());
            storeMock.mock.findByDomain.mockResolvedValue(null);
            storeMock.mock.create.mockResolvedValue(undefined);

            const report = await service.syncSingleAccount('acme.com');

            expect(report.created).toBe(1);
            expect(clientMock.mock.getCompanyByDomain).toHaveBeenCalledWith('acme.com');
        });

        it('skips when no HubSpot company matches the domain', async () => {
            clientMock.mock.getCompanyByDomain.mockResolvedValue(null);

            const report = await service.syncSingleAccount('unknown.com');

            expect(report.skipped).toBe(1);
            expect(report.created).toBe(0);
        });

        it('handles search API errors', async () => {
            clientMock.mock.getCompanyByDomain.mockRejectedValue(
                new Error('Search failed'),
            );

            const report = await service.syncSingleAccount('acme.com');

            expect(report.errors).toHaveLength(1);
            expect(report.errors[0].message).toContain('Search failed');
        });

        it('updates existing account when found', async () => {
            clientMock.mock.getCompanyByDomain.mockResolvedValue(makeCompany());
            storeMock.mock.findByDomain.mockResolvedValue(makeExistingAccount());
            storeMock.mock.update.mockResolvedValue(undefined);

            const report = await service.syncSingleAccount('acme.com');

            expect(report.updated).toBe(1);
            expect(report.created).toBe(0);
        });
    });
});
