import { describe, it, expect } from 'vitest';
import {
    MOCK_ACCOUNTS_FULL,
    filterMockAccounts,
    findMockAccountFull,
    getAccountsWithTicketCounts,
} from '@/lib/mock-accounts';
import { AccountSentiment, AccountEngagement } from '@outpost/shared';

describe('Accounts API logic', () => {
    describe('MOCK_ACCOUNTS_FULL', () => {
        it('has 10 mock accounts', () => {
            expect(MOCK_ACCOUNTS_FULL).toHaveLength(10);
        });

        it('every account has required fields', () => {
            for (const account of MOCK_ACCOUNTS_FULL) {
                expect(account.id).toBeTruthy();
                expect(account.name).toBeTruthy();
                expect(account.sentiment).toBeTruthy();
                expect(account.engagement).toBeTruthy();
                expect(account.createdAt).toBeTruthy();
                expect(account.updatedAt).toBeTruthy();
            }
        });
    });

    describe('getAccountsWithTicketCounts', () => {
        it('returns all accounts with ticket count properties', () => {
            const accounts = getAccountsWithTicketCounts();
            expect(accounts).toHaveLength(10);
            for (const account of accounts) {
                expect(account).toHaveProperty('openTickets');
                expect(account).toHaveProperty('inProgressTickets');
                expect(account).toHaveProperty('closedTickets');
                expect(typeof account.openTickets).toBe('number');
                expect(typeof account.inProgressTickets).toBe('number');
                expect(typeof account.closedTickets).toBe('number');
            }
        });

        it('acc-1 has correct ticket counts from mock ticket data', () => {
            const accounts = getAccountsWithTicketCounts();
            const acme = accounts.find(a => a.id === 'acc-1');
            expect(acme).toBeDefined();
            // acc-1 (Acme Corp) has tickets tkt-1 (OPEN), tkt-4 (WAITING_ON_TEAM), tkt-5 (OPEN)
            expect(acme!.openTickets).toBe(3);
            expect(acme!.inProgressTickets).toBe(0);
            expect(acme!.closedTickets).toBe(0);
        });
    });

    describe('findMockAccountFull', () => {
        it('finds account by ID', () => {
            const account = findMockAccountFull('acc-1');
            expect(account).toBeDefined();
            expect(account!.name).toBe('Acme Corp');
        });

        it('returns ticket counts for found account', () => {
            const account = findMockAccountFull('acc-1');
            expect(account).toBeDefined();
            expect(account).toHaveProperty('openTickets');
            expect(account).toHaveProperty('inProgressTickets');
            expect(account).toHaveProperty('closedTickets');
        });

        it('returns undefined for non-existent ID', () => {
            const account = findMockAccountFull('nonexistent');
            expect(account).toBeUndefined();
        });
    });

    describe('filterMockAccounts', () => {
        it('returns all accounts when no filters applied', () => {
            const result = filterMockAccounts({});
            expect(result).toHaveLength(10);
        });

        it('filters by search term matching name', () => {
            const result = filterMockAccounts({ search: 'Acme' });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Acme Corp');
        });

        it('filters by search term matching domain', () => {
            const result = filterMockAccounts({ search: 'techstart' });
            expect(result).toHaveLength(1);
            expect(result[0].domain).toBe('techstart.io');
        });

        it('filters by search term matching owner', () => {
            const result = filterMockAccounts({ search: 'Jordan' });
            expect(result.length).toBeGreaterThan(0);
            expect(result.every(a => a.owner?.includes('Jordan'))).toBe(true);
        });

        it('filters by owner', () => {
            const result = filterMockAccounts({ owner: 'Atai Barkai' });
            expect(result.length).toBeGreaterThan(0);
            expect(result.every(a => a.owner === 'Atai Barkai')).toBe(true);
        });

        it('filters by sentiment', () => {
            const result = filterMockAccounts({ sentiment: [AccountSentiment.HAPPY] });
            expect(result.length).toBeGreaterThan(0);
            expect(result.every(a => a.sentiment === AccountSentiment.HAPPY)).toBe(true);
        });

        it('filters by engagement', () => {
            const result = filterMockAccounts({ engagement: [AccountEngagement.HIGH] });
            expect(result.length).toBeGreaterThan(0);
            expect(result.every(a => a.engagement === AccountEngagement.HIGH)).toBe(true);
        });

        it('returns empty for non-matching search', () => {
            const result = filterMockAccounts({ search: 'zzzznonexistent' });
            expect(result).toHaveLength(0);
        });

        it('sorts by name ascending', () => {
            const result = filterMockAccounts({ sort: 'name', sortDir: 'asc' });
            for (let i = 1; i < result.length; i++) {
                expect(result[i].name.localeCompare(result[i - 1].name)).toBeGreaterThanOrEqual(0);
            }
        });

        it('sorts by acv descending', () => {
            const result = filterMockAccounts({ sort: 'acv', sortDir: 'desc' });
            const withAcv = result.filter(a => a.acv != null);
            for (let i = 1; i < withAcv.length; i++) {
                expect(withAcv[i].acv!).toBeLessThanOrEqual(withAcv[i - 1].acv!);
            }
        });

        it('combines search and sentiment filters', () => {
            const result = filterMockAccounts({
                search: 'Acme',
                sentiment: [AccountSentiment.HAPPY],
            });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Acme Corp');
        });
    });
});
