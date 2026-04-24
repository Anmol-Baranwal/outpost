import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRef } from 'react';
import { AddNoteForm } from '@/components/tickets/add-note-form';
import type { AddNoteFormHandle } from '@/components/tickets/add-note-form';

vi.stubGlobal('fetch', vi.fn());

describe('AddNoteForm', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the add note button initially', () => {
        render(<AddNoteForm ticketId="tkt-1" />);
        expect(screen.getByTestId('add-note-button')).toBeInTheDocument();
        expect(screen.getByText('+ Add a note')).toBeInTheDocument();
    });

    it('opens the form when button is clicked', () => {
        render(<AddNoteForm ticketId="tkt-1" />);
        fireEvent.click(screen.getByTestId('add-note-button'));
        expect(screen.getByTestId('add-note-form')).toBeInTheDocument();
        expect(screen.getByTestId('add-note-textarea')).toBeInTheDocument();
    });

    it('opens the form via ref.focus()', async () => {
        const ref = createRef<AddNoteFormHandle>();
        render(<AddNoteForm ref={ref} ticketId="tkt-1" />);

        act(() => {
            ref.current?.focus();
        });

        await waitFor(() => {
            expect(screen.getByTestId('add-note-form')).toBeInTheDocument();
        });
    });

    it('closes the form when cancel is clicked', () => {
        render(<AddNoteForm ticketId="tkt-1" />);
        fireEvent.click(screen.getByTestId('add-note-button'));
        expect(screen.getByTestId('add-note-form')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('add-note-cancel'));
        expect(screen.queryByTestId('add-note-form')).not.toBeInTheDocument();
        expect(screen.getByTestId('add-note-button')).toBeInTheDocument();
    });

    it('submits note and calls onNoteAdded', async () => {
        const onNoteAdded = vi.fn();
        const mockNote = {
            id: 'note-1',
            ticketId: 'tkt-1',
            author: 'You',
            content: 'Test note',
            createdAt: '2025-04-20T00:00:00Z',
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockNote),
        });

        render(<AddNoteForm ticketId="tkt-1" onNoteAdded={onNoteAdded} />);

        // Open form
        fireEvent.click(screen.getByTestId('add-note-button'));

        // Type content
        fireEvent.change(screen.getByTestId('add-note-textarea'), {
            target: { value: 'Test note' },
        });

        // Submit
        fireEvent.click(screen.getByTestId('add-note-submit'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tickets/tkt-1/notes',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ content: 'Test note' }),
                }),
            );
        });

        await waitFor(() => {
            expect(onNoteAdded).toHaveBeenCalledWith(mockNote);
        });
    });

    it('does not submit when content is empty', () => {
        render(<AddNoteForm ticketId="tkt-1" />);
        fireEvent.click(screen.getByTestId('add-note-button'));

        const submitBtn = screen.getByTestId('add-note-submit');
        expect(submitBtn).toBeDisabled();
    });
});
