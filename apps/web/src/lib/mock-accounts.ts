/**
 * Mock account data for development before database is connected.
 */
import {
    AccountSentiment,
    AccountEngagement,
    TicketStatus,
} from '@copilotkit/outpost/shared';
import { MOCK_TICKETS } from './mock-tickets';

export interface MockAccountFull {
    id: string;
    name: string;
    domain: string | null;
    owner: string | null;
    sentiment: AccountSentiment;
    engagement: AccountEngagement;
    acv: number | null;
    closeDate: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AccountWithTicketCounts extends MockAccountFull {
    openTickets: number;
    inProgressTickets: number;
    closedTickets: number;
}

export const MOCK_ACCOUNTS_FULL: MockAccountFull[] = [
    {
        id: 'acc-1',
        name: 'Acme Corp',
        domain: 'acme.com',
        owner: 'Atai Barkai',
        sentiment: AccountSentiment.HAPPY,
        engagement: AccountEngagement.HIGH,
        acv: 120000,
        closeDate: '2025-06-15T00:00:00Z',
        createdAt: '2024-09-15T10:00:00Z',
        updatedAt: '2025-04-14T10:20:00Z',
    },
    {
        id: 'acc-2',
        name: 'TechStart Inc',
        domain: 'techstart.io',
        owner: 'Markus Ecker',
        sentiment: AccountSentiment.NEUTRAL,
        engagement: AccountEngagement.MEDIUM,
        acv: 45000,
        closeDate: '2025-08-01T00:00:00Z',
        createdAt: '2024-10-01T08:00:00Z',
        updatedAt: '2025-04-13T15:30:00Z',
    },
    {
        id: 'acc-3',
        name: 'DataFlow Labs',
        domain: 'dataflow.dev',
        owner: 'Jordan Ritter',
        sentiment: AccountSentiment.AT_RISK,
        engagement: AccountEngagement.LOW,
        acv: 85000,
        closeDate: '2025-05-30T00:00:00Z',
        createdAt: '2024-11-20T14:00:00Z',
        updatedAt: '2025-04-15T08:00:00Z',
    },
    {
        id: 'acc-4',
        name: 'CloudNine Solutions',
        domain: 'cloudnine.io',
        owner: 'Atai Barkai',
        sentiment: AccountSentiment.HAPPY,
        engagement: AccountEngagement.HIGH,
        acv: 200000,
        closeDate: '2025-09-01T00:00:00Z',
        createdAt: '2024-08-10T09:00:00Z',
        updatedAt: '2025-04-10T12:00:00Z',
    },
    {
        id: 'acc-5',
        name: 'Nexus AI',
        domain: 'nexusai.com',
        owner: 'Markus Ecker',
        sentiment: AccountSentiment.CHURNING,
        engagement: AccountEngagement.INACTIVE,
        acv: 30000,
        closeDate: null,
        createdAt: '2024-12-01T11:00:00Z',
        updatedAt: '2025-03-20T09:00:00Z',
    },
    {
        id: 'acc-6',
        name: 'Pinnacle Dynamics',
        domain: 'pinnacledyn.com',
        owner: 'Jordan Ritter',
        sentiment: AccountSentiment.NEUTRAL,
        engagement: AccountEngagement.MEDIUM,
        acv: 75000,
        closeDate: '2025-07-15T00:00:00Z',
        createdAt: '2024-07-22T10:00:00Z',
        updatedAt: '2025-04-05T16:00:00Z',
    },
    {
        id: 'acc-7',
        name: 'Quantum Leap Tech',
        domain: 'quantumleap.dev',
        owner: 'Atai Barkai',
        sentiment: AccountSentiment.HAPPY,
        engagement: AccountEngagement.HIGH,
        acv: 150000,
        closeDate: '2025-10-01T00:00:00Z',
        createdAt: '2024-06-15T08:00:00Z',
        updatedAt: '2025-04-12T14:00:00Z',
    },
    {
        id: 'acc-8',
        name: 'Starfield Robotics',
        domain: 'starfield.ai',
        owner: null,
        sentiment: AccountSentiment.AT_RISK,
        engagement: AccountEngagement.LOW,
        acv: 55000,
        closeDate: '2025-05-01T00:00:00Z',
        createdAt: '2024-11-05T13:00:00Z',
        updatedAt: '2025-04-08T10:00:00Z',
    },
    {
        id: 'acc-9',
        name: 'Velocity Payments',
        domain: 'velocitypay.com',
        owner: 'Markus Ecker',
        sentiment: AccountSentiment.NEUTRAL,
        engagement: AccountEngagement.MEDIUM,
        acv: 90000,
        closeDate: '2025-11-01T00:00:00Z',
        createdAt: '2024-10-20T15:00:00Z',
        updatedAt: '2025-04-14T08:00:00Z',
    },
    {
        id: 'acc-10',
        name: 'Horizon Health',
        domain: 'horizonhealth.io',
        owner: 'Jordan Ritter',
        sentiment: AccountSentiment.HAPPY,
        engagement: AccountEngagement.HIGH,
        acv: 180000,
        closeDate: '2025-12-01T00:00:00Z',
        createdAt: '2024-09-01T07:00:00Z',
        updatedAt: '2025-04-15T06:00:00Z',
    },
];

export const ACCOUNT_OWNERS = [
    'Atai Barkai',
    'Markus Ecker',
    'Jordan Ritter',
];

/**
 * Compute ticket counts for an account from mock ticket data.
 */
function getTicketCounts(accountId: string) {
    const accountTickets = MOCK_TICKETS.filter(t => t.accountId === accountId);
    return {
        openTickets: accountTickets.filter(
            t => t.status === TicketStatus.OPEN || t.status === TicketStatus.WAITING_ON_CUSTOMER || t.status === TicketStatus.WAITING_ON_TEAM
        ).length,
        inProgressTickets: accountTickets.filter(
            t => t.status === TicketStatus.IN_PROGRESS
        ).length,
        closedTickets: accountTickets.filter(
            t => t.status === TicketStatus.CLOSED || t.status === TicketStatus.RESOLVED
        ).length,
    };
}

/**
 * Get all accounts with their ticket counts.
 */
export function getAccountsWithTicketCounts(): AccountWithTicketCounts[] {
    return MOCK_ACCOUNTS_FULL.map(account => ({
        ...account,
        ...getTicketCounts(account.id),
    }));
}

/**
 * Find a single account by ID with ticket counts.
 */
export function findMockAccountFull(id: string): AccountWithTicketCounts | undefined {
    const account = MOCK_ACCOUNTS_FULL.find(a => a.id === id);
    if (!account) return undefined;
    return {
        ...account,
        ...getTicketCounts(account.id),
    };
}

/**
 * Filter accounts by search term and optional filters.
 */
export function filterMockAccounts(filters: {
    search?: string;
    owner?: string;
    sentiment?: string[];
    engagement?: string[];
    sort?: string;
    sortDir?: 'asc' | 'desc';
}): AccountWithTicketCounts[] {
    let accounts = getAccountsWithTicketCounts();

    if (filters.search) {
        const q = filters.search.toLowerCase();
        accounts = accounts.filter(a =>
            a.name.toLowerCase().includes(q) ||
            (a.domain && a.domain.toLowerCase().includes(q)) ||
            (a.owner && a.owner.toLowerCase().includes(q))
        );
    }

    if (filters.owner) {
        accounts = accounts.filter(a => a.owner === filters.owner);
    }

    if (filters.sentiment?.length) {
        accounts = accounts.filter(a => filters.sentiment!.includes(a.sentiment));
    }

    if (filters.engagement?.length) {
        accounts = accounts.filter(a => filters.engagement!.includes(a.engagement));
    }

    if (filters.sort) {
        const dir = filters.sortDir === 'desc' ? -1 : 1;
        accounts.sort((a, b) => {
            const key = filters.sort as keyof AccountWithTicketCounts;
            const aVal = a[key];
            const bVal = b[key];
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return aVal.localeCompare(bVal) * dir;
            }
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return (aVal - bVal) * dir;
            }
            return 0;
        });
    }

    return accounts;
}
