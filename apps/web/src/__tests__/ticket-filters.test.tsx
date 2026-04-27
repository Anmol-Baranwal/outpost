import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketFilterPanel, DEFAULT_FILTERS } from '@/components/tickets/ticket-filters';
import type { TicketFilters } from '@/components/tickets/ticket-filters';
import type { Account, TeamMember } from '@/components/tickets/types';

const mockAccounts: Account[] = [
    { id: 'acc-1', name: 'Acme Corp', domain: 'acme.com', acv: 120000, createdAt: '2024-09-15T10:00:00Z' },
    { id: 'acc-2', name: 'TechStart Inc', domain: 'techstart.io', acv: 45000, createdAt: '2024-10-01T08:00:00Z' },
];

const mockTeamMembers: TeamMember[] = [
    { id: 'tm-1', name: 'Atai Barkai', email: 'atai@copilotkit.ai', role: 'MEMBER', avatarUrl: null },
    { id: 'tm-2', name: 'Markus Ecker', email: 'markus@copilotkit.ai', role: 'MEMBER', avatarUrl: null },
];

describe('TicketFilterPanel', () => {
    const defaultProps = {
        filters: DEFAULT_FILTERS,
        onFiltersChange: vi.fn(),
        accounts: mockAccounts,
        teamMembers: mockTeamMembers,
    };

    it('renders search input', () => {
        render(<TicketFilterPanel {...defaultProps} />);
        expect(screen.getByTestId('ticket-search-input')).toBeInTheDocument();
    });

    it('renders filter toggle button', () => {
        render(<TicketFilterPanel {...defaultProps} />);
        expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('calls onFiltersChange when search input changes', () => {
        const onFiltersChange = vi.fn();
        render(<TicketFilterPanel {...defaultProps} onFiltersChange={onFiltersChange} />);

        const searchInput = screen.getByTestId('ticket-search-input');
        fireEvent.change(searchInput, { target: { value: 'test query' } });

        expect(onFiltersChange).toHaveBeenCalledWith({
            ...DEFAULT_FILTERS,
            search: 'test query',
        });
    });

    it('expands filter panel when button is clicked', () => {
        render(<TicketFilterPanel {...defaultProps} />);

        fireEvent.click(screen.getByText('Filters'));

        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Priority')).toBeInTheDocument();
        expect(screen.getByText('Source')).toBeInTheDocument();
    });

    it('shows active filter count in button', () => {
        const filtersWithActive: TicketFilters = {
            ...DEFAULT_FILTERS,
            status: ['OPEN'],
            priority: ['HIGH'],
        };
        render(
            <TicketFilterPanel
                {...defaultProps}
                filters={filtersWithActive}
            />,
        );

        expect(screen.getByText('Filters (2)')).toBeInTheDocument();
    });

    it('shows Reset button when filters are expanded', () => {
        render(<TicketFilterPanel {...defaultProps} />);
        fireEvent.click(screen.getByText('Filters'));
        expect(screen.getByText('Reset')).toBeInTheDocument();
    });

    it('resets filters when Reset is clicked', () => {
        const onFiltersChange = vi.fn();
        const filtersWithActive: TicketFilters = {
            ...DEFAULT_FILTERS,
            status: ['OPEN'],
        };
        render(
            <TicketFilterPanel
                filters={filtersWithActive}
                onFiltersChange={onFiltersChange}
                accounts={mockAccounts}
                teamMembers={mockTeamMembers}
            />,
        );

        // Expand first
        fireEvent.click(screen.getByText('Filters (1)'));
        fireEvent.click(screen.getByText('Reset'));

        expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
    });
});
