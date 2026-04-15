/**
 * Tests for the HubSpot CRM client.
 *
 * Mocks @hubspot/api-client to test field mapping, pagination,
 * domain search, and error handling in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockGetPage = vi.fn();
const mockDoSearch = vi.fn();
const mockGetById = vi.fn();

vi.mock('@hubspot/api-client', () => ({
    Client: vi.fn().mockImplementation(() => ({
        crm: {
            companies: {
                basicApi: { getPage: mockGetPage },
                searchApi: { doSearch: mockDoSearch },
            },
            owners: {
                ownersApi: { getById: mockGetById },
            },
        },
    })),
}));

// Import after mocks
const { HubSpotClient } = await import('../hubspot.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCompanyResult(overrides: Record<string, string | undefined> = {}) {
    return {
        id: overrides.id ?? '101',
        properties: {
            name: 'Acme Corp',
            domain: 'acme.com',
            amount: '50000',
            closedate: '2026-06-15T00:00:00Z',
            hubspot_owner_id: '42',
            ...overrides,
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('HubSpotClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('throws when no API key is provided and env is unset', () => {
            const original = process.env.HUBSPOT_API_KEY;
            delete process.env.HUBSPOT_API_KEY;

            expect(() => new HubSpotClient('')).toThrow('API key is required');

            if (original) process.env.HUBSPOT_API_KEY = original;
        });

        it('accepts an API key via constructor argument', () => {
            expect(() => new HubSpotClient('test-key')).not.toThrow();
        });
    });

    describe('getCompanies', () => {
        it('returns all companies from a single page', async () => {
            mockGetPage.mockResolvedValueOnce({
                results: [makeCompanyResult(), makeCompanyResult({ id: '102', name: 'Beta Inc' })],
                paging: undefined,
            });

            const client = new HubSpotClient('test-key');
            const companies = await client.getCompanies();

            expect(companies).toHaveLength(2);
            expect(companies[0].id).toBe('101');
            expect(companies[1].id).toBe('102');
        });

        it('paginates through multiple pages', async () => {
            mockGetPage
                .mockResolvedValueOnce({
                    results: [makeCompanyResult({ id: '1' })],
                    paging: { next: { after: 'cursor-1' } },
                })
                .mockResolvedValueOnce({
                    results: [makeCompanyResult({ id: '2' })],
                    paging: undefined,
                });

            const client = new HubSpotClient('test-key');
            const companies = await client.getCompanies();

            expect(companies).toHaveLength(2);
            expect(mockGetPage).toHaveBeenCalledTimes(2);
        });
    });

    describe('getCompanyByDomain', () => {
        it('returns a company when found', async () => {
            mockDoSearch.mockResolvedValueOnce({
                results: [makeCompanyResult()],
            });

            const client = new HubSpotClient('test-key');
            const company = await client.getCompanyByDomain('acme.com');

            expect(company).not.toBeNull();
            expect(company!.properties.domain).toBe('acme.com');
        });

        it('returns null when no company matches', async () => {
            mockDoSearch.mockResolvedValueOnce({ results: [] });

            const client = new HubSpotClient('test-key');
            const company = await client.getCompanyByDomain('unknown.com');

            expect(company).toBeNull();
        });
    });

    describe('syncCompanyToAccount', () => {
        it('maps all fields correctly', async () => {
            mockGetById.mockResolvedValueOnce({
                firstName: 'Jane',
                lastName: 'Doe',
                email: 'jane@example.com',
            });

            const client = new HubSpotClient('test-key');
            const company = makeCompanyResult();
            const account = await client.syncCompanyToAccount(company);

            expect(account.name).toBe('Acme Corp');
            expect(account.domain).toBe('acme.com');
            expect(account.acv).toBe(50000);
            expect(account.closeDate).toEqual(new Date('2026-06-15T00:00:00Z'));
            expect(account.owner).toBe('Jane Doe');
        });

        it('handles missing optional fields gracefully', async () => {
            const client = new HubSpotClient('test-key');
            const company = {
                id: '999',
                properties: {} as Record<string, string | undefined>,
            };

            const account = await client.syncCompanyToAccount(company);

            expect(account.name).toBe('HubSpot Company 999');
            expect(account.domain).toBeNull();
            expect(account.acv).toBeNull();
            expect(account.closeDate).toBeNull();
            expect(account.owner).toBeNull();
        });

        it('handles invalid date strings', async () => {
            const client = new HubSpotClient('test-key');
            const company = makeCompanyResult({
                closedate: 'not-a-date',
                hubspot_owner_id: undefined,
            });

            const account = await client.syncCompanyToAccount(company);

            expect(account.closeDate).toBeNull();
        });

        it('handles invalid amount strings', async () => {
            const client = new HubSpotClient('test-key');
            const company = makeCompanyResult({
                amount: 'not-a-number',
                hubspot_owner_id: undefined,
            });

            const account = await client.syncCompanyToAccount(company);

            expect(account.acv).toBeNull();
        });

        it('caches owner lookups', async () => {
            mockGetById.mockResolvedValue({
                firstName: 'Jane',
                lastName: 'Doe',
                email: 'jane@example.com',
            });

            const client = new HubSpotClient('test-key');
            const company1 = makeCompanyResult({ id: '1' });
            const company2 = makeCompanyResult({ id: '2' });

            await client.syncCompanyToAccount(company1);
            await client.syncCompanyToAccount(company2);

            // Owner API should only be called once due to caching
            expect(mockGetById).toHaveBeenCalledTimes(1);
        });

        it('handles owner resolution failure gracefully', async () => {
            mockGetById.mockRejectedValueOnce(new Error('Not found'));

            const client = new HubSpotClient('test-key');
            const company = makeCompanyResult();

            const account = await client.syncCompanyToAccount(company);

            expect(account.owner).toBeNull();
        });
    });
});
