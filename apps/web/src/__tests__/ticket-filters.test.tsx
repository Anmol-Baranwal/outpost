import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketFilterPanel, DEFAULT_FILTERS } from '@/components/tickets/ticket-filters';
import type { TicketFilters } from '@/components/tickets/ticket-filters';

describe('TicketFilterPanel', () => {
    const defaultProps = {
        filters: DEFAULT_FILTERS,
        onFiltersChange: vi.fn(),
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
            />,
        );

        // Expand first
        fireEvent.click(screen.getByText('Filters (1)'));
        fireEvent.click(screen.getByText('Reset'));

        expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
    });
});
