import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateTicketModal } from '@/components/tickets/create-ticket-modal';

// Suppress the "Error: Not implemented: HTMLFormElement.prototype.requestSubmit" from jsdom
vi.stubGlobal('fetch', vi.fn());

describe('CreateTicketModal', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not render when closed', () => {
        render(
            <CreateTicketModal open={false} onClose={vi.fn()} />,
        );
        expect(screen.queryByTestId('create-ticket-modal')).not.toBeInTheDocument();
    });

    it('renders when open', () => {
        render(
            <CreateTicketModal open={true} onClose={vi.fn()} />,
        );
        expect(screen.getByTestId('create-ticket-modal')).toBeInTheDocument();
        // Title in header and submit button both contain "Create Ticket"
        const matches = screen.getAllByText(/Create Ticket/);
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders all form fields', () => {
        render(
            <CreateTicketModal open={true} onClose={vi.fn()} />,
        );
        expect(screen.getByTestId('create-ticket-title')).toBeInTheDocument();
        expect(screen.getByTestId('create-ticket-description')).toBeInTheDocument();
        expect(screen.getByTestId('create-ticket-priority')).toBeInTheDocument();
        expect(screen.getByTestId('create-ticket-type')).toBeInTheDocument();
        expect(screen.getByTestId('create-ticket-source')).toBeInTheDocument();
    });

    it('calls onClose when cancel is clicked', () => {
        const onClose = vi.fn();
        render(
            <CreateTicketModal open={true} onClose={onClose} />,
        );
        fireEvent.click(screen.getByTestId('create-ticket-cancel'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <CreateTicketModal open={true} onClose={onClose} />,
        );
        fireEvent.click(screen.getByTestId('create-ticket-close'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows validation error when title is empty', async () => {
        render(
            <CreateTicketModal open={true} onClose={vi.fn()} />,
        );

        fireEvent.click(screen.getByTestId('create-ticket-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('create-ticket-error')).toHaveTextContent('Title is required');
        });
    });

    it('shows validation error when description is empty but title is filled', async () => {
        render(
            <CreateTicketModal open={true} onClose={vi.fn()} />,
        );

        fireEvent.change(screen.getByTestId('create-ticket-title'), {
            target: { value: 'Test ticket' },
        });
        fireEvent.click(screen.getByTestId('create-ticket-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('create-ticket-error')).toHaveTextContent('Description is required');
        });
    });

    it('submits the form and calls onCreated on success', async () => {
        const onClose = vi.fn();
        const onCreated = vi.fn();
        const mockTicket = { id: 'tkt-1', title: 'Test', description: 'Desc' };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTicket),
        });

        render(
            <CreateTicketModal open={true} onClose={onClose} onCreated={onCreated} />,
        );

        fireEvent.change(screen.getByTestId('create-ticket-title'), {
            target: { value: 'Test ticket' },
        });
        fireEvent.change(screen.getByTestId('create-ticket-description'), {
            target: { value: 'A test description' },
        });
        fireEvent.click(screen.getByTestId('create-ticket-submit'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith('/api/tickets', expect.objectContaining({
                method: 'POST',
            }));
        });

        await waitFor(() => {
            expect(onCreated).toHaveBeenCalledWith(mockTicket);
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('shows error on API failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            json: () => Promise.resolve({ error: 'Server error' }),
        });

        render(
            <CreateTicketModal open={true} onClose={vi.fn()} />,
        );

        fireEvent.change(screen.getByTestId('create-ticket-title'), {
            target: { value: 'Test' },
        });
        fireEvent.change(screen.getByTestId('create-ticket-description'), {
            target: { value: 'Description' },
        });
        fireEvent.click(screen.getByTestId('create-ticket-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('create-ticket-error')).toHaveTextContent('Server error');
        });
    });

    it('calls onClose when overlay is clicked', () => {
        const onClose = vi.fn();
        render(
            <CreateTicketModal open={true} onClose={onClose} />,
        );
        fireEvent.click(screen.getByTestId('create-ticket-overlay'));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
