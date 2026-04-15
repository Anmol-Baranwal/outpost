/**
 * Mock broadcast data for development before database is connected.
 */
import { MOCK_TEAM_MEMBERS, MOCK_ACCOUNTS } from '@/lib/mock-tickets';
import type { MockAccount, MockTeamMember } from '@/lib/mock-tickets';

export type BroadcastStatus = 'draft' | 'sent';

export interface MockBroadcast {
    id: string;
    message: string;
    status: BroadcastStatus;
    audienceType: 'all' | 'specific';
    audienceAccountIds: string[];
    audienceAccounts: MockAccount[];
    senderId: string;
    sender: MockTeamMember;
    createdAt: string;
    sentAt: string | null;
}

export const MAX_BROADCAST_LENGTH = 500;

export const MOCK_BROADCASTS: MockBroadcast[] = [
    {
        id: 'bc-1',
        message: 'We are excited to announce CopilotKit v2.0 with full streaming support, improved action handling, and a brand new developer experience. Upgrade today to take advantage of these improvements.',
        status: 'sent',
        audienceType: 'all',
        audienceAccountIds: [],
        audienceAccounts: [],
        senderId: 'tm-1',
        sender: MOCK_TEAM_MEMBERS[0],
        createdAt: '2025-03-10T09:00:00Z',
        sentAt: '2025-03-10T09:05:00Z',
    },
    {
        id: 'bc-2',
        message: 'Scheduled maintenance window: Our API will undergo maintenance on March 20th from 2:00 AM to 4:00 AM UTC. Please plan accordingly.',
        status: 'sent',
        audienceType: 'all',
        audienceAccountIds: [],
        audienceAccounts: [],
        senderId: 'tm-3',
        sender: MOCK_TEAM_MEMBERS[2],
        createdAt: '2025-03-15T14:00:00Z',
        sentAt: '2025-03-15T14:30:00Z',
    },
    {
        id: 'bc-3',
        message: 'Your dedicated support engineer has changed. Please reach out to Markus for any future questions regarding your integration.',
        status: 'sent',
        audienceType: 'specific',
        audienceAccountIds: ['acc-1', 'acc-3'],
        audienceAccounts: [MOCK_ACCOUNTS[0], MOCK_ACCOUNTS[2]],
        senderId: 'tm-2',
        sender: MOCK_TEAM_MEMBERS[1],
        createdAt: '2025-03-18T11:00:00Z',
        sentAt: '2025-03-18T11:15:00Z',
    },
    {
        id: 'bc-4',
        message: 'Draft: Introducing our new Enterprise tier with priority support, dedicated infrastructure, and custom SLAs. Contact your account manager for details.',
        status: 'draft',
        audienceType: 'all',
        audienceAccountIds: [],
        audienceAccounts: [],
        senderId: 'tm-1',
        sender: MOCK_TEAM_MEMBERS[0],
        createdAt: '2025-03-20T16:00:00Z',
        sentAt: null,
    },
    {
        id: 'bc-5',
        message: 'Draft: We noticed your team has not yet migrated to the v2 SDK. Would you like to schedule a migration session with our engineering team?',
        status: 'draft',
        audienceType: 'specific',
        audienceAccountIds: ['acc-2'],
        audienceAccounts: [MOCK_ACCOUNTS[1]],
        senderId: 'tm-3',
        sender: MOCK_TEAM_MEMBERS[2],
        createdAt: '2025-03-22T10:00:00Z',
        sentAt: null,
    },
];

export interface BroadcastFilterOptions {
    status?: BroadcastStatus;
}

export function filterMockBroadcasts(options: BroadcastFilterOptions): MockBroadcast[] {
    let result = [...MOCK_BROADCASTS];

    if (options.status) {
        result = result.filter((b) => b.status === options.status);
    }

    // Sort: drafts first (by createdAt desc), then sent (by sentAt desc)
    result.sort((a, b) => {
        const dateA = a.sentAt || a.createdAt;
        const dateB = b.sentAt || b.createdAt;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return result;
}

export function findMockBroadcast(id: string): MockBroadcast | undefined {
    return MOCK_BROADCASTS.find((b) => b.id === id);
}
