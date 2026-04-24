import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTicketShortcuts } from '@/hooks/use-ticket-shortcuts';
import type { TicketShortcutActions } from '@/hooks/use-ticket-shortcuts';

function fireKey(key: string, options: Partial<KeyboardEvent> = {}) {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        ...options,
    });
    document.dispatchEvent(event);
}

describe('useTicketShortcuts', () => {
    let actions: TicketShortcutActions;

    beforeEach(() => {
        actions = {
            focusSearch: vi.fn(),
            previousTicket: vi.fn(),
            nextTicket: vi.fn(),
            focusReply: vi.fn(),
            addNote: vi.fn(),
            markAsDone: vi.fn(),
            createTicket: vi.fn(),
            toggleDiscussions: vi.fn(),
        };
    });

    it('/ triggers focusSearch', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('/');
        expect(actions.focusSearch).toHaveBeenCalledOnce();
    });

    it('f triggers previousTicket', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('f');
        expect(actions.previousTicket).toHaveBeenCalledOnce();
    });

    it('j triggers nextTicket', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('j');
        expect(actions.nextTicket).toHaveBeenCalledOnce();
    });

    it('r triggers focusReply', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('r');
        expect(actions.focusReply).toHaveBeenCalledOnce();
    });

    it('n triggers addNote', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('n');
        expect(actions.addNote).toHaveBeenCalledOnce();
    });

    it('e triggers markAsDone', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('e');
        expect(actions.markAsDone).toHaveBeenCalledOnce();
    });

    it('c triggers createTicket', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('c');
        expect(actions.createTicket).toHaveBeenCalledOnce();
    });

    it('d triggers toggleDiscussions', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('d');
        expect(actions.toggleDiscussions).toHaveBeenCalledOnce();
    });

    it('does not trigger on Ctrl+key combos', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('r', { ctrlKey: true });
        expect(actions.focusReply).not.toHaveBeenCalled();
    });

    it('does not trigger on Meta+key combos', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('r', { metaKey: true });
        expect(actions.focusReply).not.toHaveBeenCalled();
    });

    it('handles uppercase keys', () => {
        renderHook(() => useTicketShortcuts(actions));
        fireKey('J');
        expect(actions.nextTicket).toHaveBeenCalledOnce();
    });

    it('cleans up event listener on unmount', () => {
        const { unmount } = renderHook(() => useTicketShortcuts(actions));
        unmount();
        fireKey('r');
        expect(actions.focusReply).not.toHaveBeenCalled();
    });
});
