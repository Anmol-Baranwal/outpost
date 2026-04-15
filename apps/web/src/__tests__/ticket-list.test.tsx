import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketList } from '@/components/tickets/ticket-list';
import { MOCK_TICKETS } from '@/lib/mock-tickets';

// Mock next/navigation
vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
    }),
    useParams: () => ({}),
}));

describe('TicketList', () => {
    it('renders ticket count', () => {
        render(<TicketList tickets={MOCK_TICKETS} />);
        expect(screen.getByText(`${MOCK_TICKETS.length} tickets`)).toBeInTheDocument();
    });

    it('renders all ticket cards', () => {
        render(<TicketList tickets={MOCK_TICKETS} />);
        for (const ticket of MOCK_TICKETS) {
            expect(screen.getByText(ticket.displayId)).toBeInTheDocument();
        }
    });

    it('renders priority badges', () => {
        render(<TicketList tickets={MOCK_TICKETS} />);
        // There should be at least one "High" badge
        expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    });

    it('shows empty state when no tickets', () => {
        render(<TicketList tickets={[]} />);
        expect(screen.getByText('No tickets match the current filters.')).toBeInTheDocument();
    });

    it('renders account names for tickets with accounts', () => {
        render(<TicketList tickets={MOCK_TICKETS} />);
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
    });

    it('shows unread indicator for unread tickets', () => {
        const unreadTickets = MOCK_TICKETS.filter((t) => t.unread);
        render(<TicketList tickets={unreadTickets} />);
        // Unread dots are rendered as spans with bg-blue-500
        const unreadDots = document.querySelectorAll('.bg-blue-500');
        expect(unreadDots.length).toBe(unreadTickets.length);
    });
});
