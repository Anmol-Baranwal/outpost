import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketList } from '@/components/tickets/ticket-list';
import {
    TicketStatus,
    TicketPriority,
    TicketType,
    TicketSource,
    MessageType,
} from '@copilotkit/outpost/shared';
import type { Ticket } from '@/components/tickets/types';

// Mock next/navigation
vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
    }),
    useParams: () => ({}),
}));

const testTickets: Ticket[] = [
    {
        id: 'tkt-1',
        displayId: 'TKT-A7B3',
        title: 'CopilotRuntime crashes on streaming response with custom actions',
        description: 'When using CopilotRuntime with a custom action that returns a large payload, the streaming response crashes.',
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
        type: TicketType.BUG,
        source: TicketSource.DISCORD,
        sourceUrl: 'https://discord.com/channels/1234/5678/91011',
        additionalInfo: null,
        suggestedResponse: null,
        assigneeId: 'tm-1',
        assignee: { id: 'tm-1', name: 'Atai Barkai', email: 'atai@copilotkit.ai', role: 'MEMBER', avatarUrl: null },
        accountId: 'acc-1',
        account: { id: 'acc-1', name: 'Acme Corp', domain: 'acme.com', acv: 120000, createdAt: '2024-09-15T10:00:00Z' },
        userId: 'user-1',
        user: { id: 'user-1', name: 'Alice Chen', email: 'alice@acme.com' },
        messages: [
            {
                id: 'msg-1',
                ticketId: 'tkt-1',
                author: 'Alice Chen',
                content: 'Seeing crashes with large payloads.',
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: '2025-04-14T09:30:00Z',
            },
        ],
        slaBreachedAt: null,
        createdAt: '2025-04-14T09:30:00Z',
        updatedAt: '2025-04-14T10:20:00Z',
    },
    {
        id: 'tkt-2',
        displayId: 'TKT-K9M2',
        title: 'useCopilotChat not re-rendering on message updates',
        description: 'The useCopilotChat hook does not trigger re-renders when new messages arrive.',
        status: TicketStatus.IN_PROGRESS,
        priority: TicketPriority.MEDIUM,
        type: TicketType.BUG,
        source: TicketSource.GITHUB_ISSUE,
        sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/2345',
        additionalInfo: null,
        suggestedResponse: null,
        assigneeId: 'tm-2',
        assignee: { id: 'tm-2', name: 'Markus Ecker', email: 'markus@copilotkit.ai', role: 'MEMBER', avatarUrl: null },
        accountId: 'acc-2',
        account: { id: 'acc-2', name: 'TechStart Inc', domain: 'techstart.io', acv: 45000, createdAt: '2024-10-01T08:00:00Z' },
        userId: 'user-2',
        user: { id: 'user-2', name: 'Bob Kim', email: 'bob@techstart.io' },
        messages: [],
        slaBreachedAt: null,
        createdAt: '2025-04-13T14:00:00Z',
        updatedAt: '2025-04-13T15:30:00Z',
    },
    {
        id: 'tkt-3',
        displayId: 'TKT-P4R8',
        title: 'How to implement multi-agent orchestration?',
        description: 'Looking for guidance on setting up multiple agents.',
        status: TicketStatus.OPEN,
        priority: TicketPriority.LOW,
        type: TicketType.QUESTION,
        source: TicketSource.DISCORD,
        sourceUrl: null,
        additionalInfo: null,
        suggestedResponse: null,
        assigneeId: null,
        assignee: null,
        accountId: 'acc-1',
        account: { id: 'acc-1', name: 'Acme Corp', domain: 'acme.com', acv: 120000, createdAt: '2024-09-15T10:00:00Z' },
        userId: 'user-3',
        user: { id: 'user-3', name: 'Carlos Mendez', email: 'carlos@dataflow.dev' },
        messages: [],
        slaBreachedAt: null,
        createdAt: '2025-04-15T08:00:00Z',
        updatedAt: '2025-04-15T08:00:00Z',
    },
];

describe('TicketList', () => {
    it('renders ticket count', () => {
        render(<TicketList tickets={testTickets} />);
        expect(screen.getByText(`${testTickets.length} tickets`)).toBeInTheDocument();
    });

    it('renders all ticket cards', () => {
        render(<TicketList tickets={testTickets} />);
        for (const ticket of testTickets) {
            expect(screen.getByText(ticket.displayId)).toBeInTheDocument();
        }
    });

    it('renders priority badges', () => {
        render(<TicketList tickets={testTickets} />);
        // There should be at least one "High" badge
        expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    });

    it('shows empty state when no tickets', () => {
        render(<TicketList tickets={[]} />);
        expect(screen.getByText('No tickets found')).toBeInTheDocument();
    });

    it('renders account names for tickets with accounts', () => {
        render(<TicketList tickets={testTickets} />);
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
    });
});
