/**
 * Mock ticket data for development before database is connected.
 */
import {
    TicketStatus,
    TicketPriority,
    TicketType,
    TicketSource,
    MessageType,
} from '@outpost/shared';

export interface MockMessage {
    id: string;
    ticketId: string;
    author: string;
    content: string;
    type: MessageType;
    isAiGenerated: boolean;
    attachments: Array<{ name: string; url: string; size: string }> | null;
    createdAt: string;
}

export interface MockNote {
    id: string;
    ticketId: string;
    author: string;
    content: string;
    createdAt: string;
}

export interface MockAccount {
    id: string;
    name: string;
    domain: string | null;
    acv: number | null;
    createdAt: string;
}

export interface MockUser {
    id: string;
    name: string;
    email: string;
}

export interface MockTeamMember {
    id: string;
    name: string;
    email: string;
    role: string;
    avatarUrl: string | null;
}

export interface MockTicket {
    id: string;
    displayId: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    type: TicketType;
    source: TicketSource;
    sourceUrl: string | null;
    additionalInfo: Record<string, string> | null;
    suggestedResponse: string | null;
    assigneeId: string | null;
    assignee: MockTeamMember | null;
    accountId: string | null;
    account: MockAccount | null;
    userId: string | null;
    user: MockUser | null;
    messages: MockMessage[];
    notes: MockNote[];
    slaBreachedAt: string | null;
    createdAt: string;
    updatedAt: string;
    unread: boolean;
}

export const MOCK_TEAM_MEMBERS: MockTeamMember[] = [
    { id: 'tm-1', name: 'Atai Barkai', email: 'atai@copilotkit.ai', role: 'ENGINEER', avatarUrl: null },
    { id: 'tm-2', name: 'Markus Ecker', email: 'markus@copilotkit.ai', role: 'SUPPORT', avatarUrl: null },
    { id: 'tm-3', name: 'Jordan Ritter', email: 'jordan@copilotkit.ai', role: 'ADMIN', avatarUrl: null },
];

export const MOCK_ACCOUNTS: MockAccount[] = [
    { id: 'acc-1', name: 'Acme Corp', domain: 'acme.com', acv: 120000, createdAt: '2024-09-15T10:00:00Z' },
    { id: 'acc-2', name: 'TechStart Inc', domain: 'techstart.io', acv: 45000, createdAt: '2024-10-01T08:00:00Z' },
    { id: 'acc-3', name: 'DataFlow Labs', domain: 'dataflow.dev', acv: 85000, createdAt: '2024-11-20T14:00:00Z' },
];

export const MOCK_TICKETS: MockTicket[] = [
    {
        id: 'tkt-1',
        displayId: 'TKT-A7B3',
        title: 'CopilotRuntime crashes on streaming response with custom actions',
        description: 'When using CopilotRuntime with a custom action that returns a large payload, the streaming response crashes with a buffer overflow error.',
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
        type: TicketType.BUG,
        source: TicketSource.DISCORD,
        sourceUrl: 'https://discord.com/channels/1234/5678/91011',
        additionalInfo: {
            'SDK Version': '1.8.0',
            'Framework': 'Next.js 15',
            'Node Version': '20.11.0',
        },
        suggestedResponse: 'This is a known issue with streaming large payloads in CopilotRuntime v1.8.0. We have a fix in the upcoming v1.8.1 release. In the meantime, you can work around this by chunking your action response.',
        assigneeId: 'tm-1',
        assignee: MOCK_TEAM_MEMBERS[0],
        accountId: 'acc-1',
        account: MOCK_ACCOUNTS[0],
        userId: 'user-1',
        user: { id: 'user-1', name: 'Alice Chen', email: 'alice@acme.com' },
        messages: [
            {
                id: 'msg-1',
                ticketId: 'tkt-1',
                author: 'Alice Chen',
                content: 'Hi, we\'re seeing crashes when our custom action returns JSON payloads larger than ~500KB. The streaming response just dies. Here\'s the error:\n\n```\nRangeError: Maximum call stack size exceeded\n    at CopilotRuntime.streamResponse\n```\n\nUsing CopilotKit v1.8.0 with Next.js 15.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-14T09:30:00Z',
            },
            {
                id: 'msg-2',
                ticketId: 'tkt-1',
                author: 'System',
                content: 'Ticket created from Discord message',
                type: MessageType.SYSTEM,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-14T09:30:00Z',
            },
            {
                id: 'msg-3',
                ticketId: 'tkt-1',
                author: 'CopilotKit Support Bot',
                content: 'I\'ve analyzed this issue. It appears to be related to the recursive serialization in the streaming handler. The `streamResponse` method doesn\'t handle large payloads well due to a recursive JSON.stringify call.\n\n**Workaround:** You can split your action response into chunks under 100KB each using pagination or lazy loading.\n\n**Root cause:** The streaming buffer has a hardcoded limit that causes stack overflow with deeply nested objects.',
                type: MessageType.BOT,
                isAiGenerated: true,
                attachments: null,
                createdAt: '2025-04-14T09:31:00Z',
            },
            {
                id: 'msg-4',
                ticketId: 'tkt-1',
                author: 'Atai Barkai',
                content: 'Thanks for the detailed report Alice. The bot analysis is correct — this is a known limitation we\'re fixing in v1.8.1. I\'ll prioritize the fix.\n\nIn the meantime, can you try returning your data in pages? Something like:\n\n```typescript\nuseCopilotAction({\n  name: "getData",\n  handler: async ({ page = 1 }) => {\n    const data = await fetchPage(page);\n    return { data, hasMore: page < totalPages };\n  }\n});\n```',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-14T10:15:00Z',
            },
        ],
        notes: [
            {
                id: 'note-1',
                ticketId: 'tkt-1',
                author: 'Atai Barkai',
                content: 'This is the same streaming buffer issue from #1847. Fix is in PR #1923.',
                createdAt: '2025-04-14T10:20:00Z',
            },
        ],
        slaBreachedAt: null,
        createdAt: '2025-04-14T09:30:00Z',
        updatedAt: '2025-04-14T10:20:00Z',
        unread: true,
    },
    {
        id: 'tkt-2',
        displayId: 'TKT-K9M2',
        title: 'useCopilotChat not re-rendering on message updates',
        description: 'The useCopilotChat hook does not trigger re-renders when new messages arrive in real-time mode.',
        status: TicketStatus.IN_PROGRESS,
        priority: TicketPriority.MEDIUM,
        type: TicketType.BUG,
        source: TicketSource.GITHUB_ISSUE,
        sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/2345',
        additionalInfo: {
            'SDK Version': '1.7.2',
            'Framework': 'React 19',
        },
        suggestedResponse: null,
        assigneeId: 'tm-2',
        assignee: MOCK_TEAM_MEMBERS[1],
        accountId: 'acc-2',
        account: MOCK_ACCOUNTS[1],
        userId: 'user-2',
        user: { id: 'user-2', name: 'Bob Kim', email: 'bob@techstart.io' },
        messages: [
            {
                id: 'msg-5',
                ticketId: 'tkt-2',
                author: 'Bob Kim',
                content: 'The chat messages don\'t update in real-time. I have to refresh the page to see new messages. Using `useCopilotChat` with `stream: true`.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: [
                    { name: 'screenshot.png', url: '/attachments/screenshot.png', size: '245 KB' },
                ],
                createdAt: '2025-04-13T14:00:00Z',
            },
            {
                id: 'msg-6',
                ticketId: 'tkt-2',
                author: 'Markus Ecker',
                content: 'Hi Bob, thanks for reporting this. Can you share your React version and whether you\'re using Strict Mode? This might be related to the React 19 concurrent rendering changes.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-13T15:30:00Z',
            },
        ],
        notes: [],
        slaBreachedAt: null,
        createdAt: '2025-04-13T14:00:00Z',
        updatedAt: '2025-04-13T15:30:00Z',
        unread: false,
    },
    {
        id: 'tkt-3',
        displayId: 'TKT-P4R8',
        title: 'How to implement multi-agent orchestration with CopilotKit?',
        description: 'Looking for guidance on setting up multiple agents that can collaborate on tasks.',
        status: TicketStatus.OPEN,
        priority: TicketPriority.LOW,
        type: TicketType.QUESTION,
        source: TicketSource.DISCORD,
        sourceUrl: null,
        additionalInfo: null,
        suggestedResponse: 'You can implement multi-agent orchestration using CoAgents. Check out our documentation at https://docs.copilotkit.ai/coagents for a complete guide on setting up collaborative agent workflows.',
        assigneeId: null,
        assignee: null,
        accountId: 'acc-3',
        account: MOCK_ACCOUNTS[2],
        userId: 'user-3',
        user: { id: 'user-3', name: 'Carlos Mendez', email: 'carlos@dataflow.dev' },
        messages: [
            {
                id: 'msg-7',
                ticketId: 'tkt-3',
                author: 'Carlos Mendez',
                content: 'We want to build a system where a planning agent breaks down tasks and delegates to specialized agents (coder, reviewer, tester). Is this possible with CopilotKit? Any examples?',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-15T08:00:00Z',
            },
        ],
        notes: [],
        slaBreachedAt: null,
        createdAt: '2025-04-15T08:00:00Z',
        updatedAt: '2025-04-15T08:00:00Z',
        unread: true,
    },
    {
        id: 'tkt-4',
        displayId: 'TKT-W2X5',
        title: 'Request: Add support for Anthropic Claude in CopilotRuntime',
        description: 'Feature request to add native Anthropic Claude model support alongside OpenAI.',
        status: TicketStatus.WAITING_ON_TEAM,
        priority: TicketPriority.MEDIUM,
        type: TicketType.FEATURE_REQUEST,
        source: TicketSource.GITHUB_DISCUSSION,
        sourceUrl: 'https://github.com/CopilotKit/CopilotKit/discussions/890',
        additionalInfo: null,
        suggestedResponse: null,
        assigneeId: 'tm-1',
        assignee: MOCK_TEAM_MEMBERS[0],
        accountId: 'acc-1',
        account: MOCK_ACCOUNTS[0],
        userId: 'user-4',
        user: { id: 'user-4', name: 'Dana Park', email: 'dana@acme.com' },
        messages: [
            {
                id: 'msg-8',
                ticketId: 'tkt-4',
                author: 'Dana Park',
                content: 'We\'d love to use Claude as our LLM backend. Currently CopilotKit seems tightly coupled to OpenAI. Is there a way to plug in other providers?',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-12T11:00:00Z',
            },
            {
                id: 'msg-9',
                ticketId: 'tkt-4',
                author: 'CopilotKit Support Bot',
                content: 'CopilotKit already supports multiple LLM providers through the LangChain adapter! You can use any LangChain-compatible model.\n\nFor Claude specifically:\n\n```typescript\nimport { CopilotRuntime } from "@copilotkit/runtime";\nimport { ChatAnthropic } from "@langchain/anthropic";\n\nconst runtime = new CopilotRuntime();\nconst model = new ChatAnthropic({ model: "claude-sonnet-4-6" });\n```\n\nSee the [LangChain adapter docs](https://docs.copilotkit.ai/reference/classes/langchain) for details.',
                type: MessageType.BOT,
                isAiGenerated: true,
                attachments: null,
                createdAt: '2025-04-12T11:01:00Z',
            },
        ],
        notes: [],
        slaBreachedAt: null,
        createdAt: '2025-04-12T11:00:00Z',
        updatedAt: '2025-04-12T11:01:00Z',
        unread: false,
    },
    {
        id: 'tkt-5',
        displayId: 'TKT-J6N1',
        title: 'SLA breach: Integration help for enterprise SSO setup',
        description: 'Enterprise customer needs help integrating CopilotKit with their SSO/SAML setup.',
        status: TicketStatus.OPEN,
        priority: TicketPriority.CRITICAL,
        type: TicketType.INTEGRATION_HELP,
        source: TicketSource.EMAIL,
        sourceUrl: null,
        additionalInfo: {
            'SSO Provider': 'Okta',
            'Enterprise Plan': 'Yes',
            'Deadline': '2025-04-18',
        },
        suggestedResponse: null,
        assigneeId: 'tm-3',
        assignee: MOCK_TEAM_MEMBERS[2],
        accountId: 'acc-1',
        account: MOCK_ACCOUNTS[0],
        userId: 'user-5',
        user: { id: 'user-5', name: 'Eve Torres', email: 'eve@acme.com' },
        messages: [
            {
                id: 'msg-10',
                ticketId: 'tkt-5',
                author: 'Eve Torres',
                content: 'We need to integrate CopilotKit with our Okta SSO setup before our compliance deadline on April 18th. Can someone help us with the SAML configuration?',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: [
                    { name: 'okta-config.pdf', url: '/attachments/okta-config.pdf', size: '1.2 MB' },
                    { name: 'saml-metadata.xml', url: '/attachments/saml-metadata.xml', size: '8 KB' },
                ],
                createdAt: '2025-04-14T16:00:00Z',
            },
            {
                id: 'msg-11',
                ticketId: 'tkt-5',
                author: 'System',
                content: 'SLA breached: First response time exceeded 15 minutes for CRITICAL priority',
                type: MessageType.SYSTEM,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-14T16:16:00Z',
            },
        ],
        notes: [],
        slaBreachedAt: '2025-04-14T16:16:00Z',
        createdAt: '2025-04-14T16:00:00Z',
        updatedAt: '2025-04-14T16:16:00Z',
        unread: true,
    },
    {
        id: 'tkt-6',
        displayId: 'TKT-M3V7',
        title: 'CopilotTextarea autocomplete suggestions are slow',
        description: 'Autocomplete in CopilotTextarea takes 3-5 seconds to appear, making it unusable.',
        status: TicketStatus.RESOLVED,
        priority: TicketPriority.LOW,
        type: TicketType.BUG,
        source: TicketSource.GITHUB_ISSUE,
        sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/2100',
        additionalInfo: null,
        suggestedResponse: null,
        assigneeId: 'tm-2',
        assignee: MOCK_TEAM_MEMBERS[1],
        accountId: 'acc-2',
        account: MOCK_ACCOUNTS[1],
        userId: 'user-6',
        user: { id: 'user-6', name: 'Frank Liu', email: 'frank@techstart.io' },
        messages: [
            {
                id: 'msg-12',
                ticketId: 'tkt-6',
                author: 'Frank Liu',
                content: 'CopilotTextarea suggestions take 3-5 seconds to show up. This makes the whole autocomplete feature useless for real-time typing.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-10T09:00:00Z',
            },
            {
                id: 'msg-13',
                ticketId: 'tkt-6',
                author: 'Markus Ecker',
                content: 'Fixed in v1.7.3 — the debounce was set too high. Updated to 150ms. Please upgrade and let us know if the issue persists.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-11T14:00:00Z',
            },
            {
                id: 'msg-14',
                ticketId: 'tkt-6',
                author: 'Frank Liu',
                content: 'Confirmed fixed in v1.7.3! Thanks for the quick turnaround.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-11T16:00:00Z',
            },
        ],
        notes: [],
        slaBreachedAt: null,
        createdAt: '2025-04-10T09:00:00Z',
        updatedAt: '2025-04-11T16:00:00Z',
        unread: false,
    },
];

/**
 * Helper to find a ticket by ID (either internal or display ID).
 */
export function findMockTicket(id: string): MockTicket | undefined {
    return MOCK_TICKETS.find(t => t.id === id || t.displayId === id);
}

/**
 * Filter mock tickets by criteria.
 */
export function filterMockTickets(filters: {
    status?: string[];
    source?: string[];
    priority?: string[];
    type?: string[];
    accountId?: string;
    assigneeId?: string;
    search?: string;
}): MockTicket[] {
    return MOCK_TICKETS.filter(ticket => {
        if (filters.status?.length && !filters.status.includes(ticket.status)) return false;
        if (filters.source?.length && !filters.source.includes(ticket.source)) return false;
        if (filters.priority?.length && !filters.priority.includes(ticket.priority)) return false;
        if (filters.type?.length && !filters.type.includes(ticket.type)) return false;
        if (filters.accountId && ticket.accountId !== filters.accountId) return false;
        if (filters.assigneeId && ticket.assigneeId !== filters.assigneeId) return false;
        if (filters.search) {
            const q = filters.search.toLowerCase();
            const searchable = [
                ticket.title,
                ticket.description,
                ticket.displayId,
                ticket.account?.name,
                ticket.user?.name,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            if (!searchable.includes(q)) return false;
        }
        return true;
    });
}
