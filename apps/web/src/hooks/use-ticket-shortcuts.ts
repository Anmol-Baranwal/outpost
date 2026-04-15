'use client';

import { useEffect, useCallback } from 'react';

export interface TicketShortcutActions {
    focusSearch: () => void;
    previousTicket: () => void;
    nextTicket: () => void;
    focusReply: () => void;
    addNote: () => void;
    markAsDone: () => void;
    createTicket: () => void;
}

/**
 * Keyboard shortcuts for the tickets view.
 *
 * /  - Focus search
 * F  - Previous ticket (mnemonic: up/Forward through list)
 * J  - Next ticket (vim-style down)
 * R  - Focus reply
 * N  - Add note
 * E  - Mark as done (close ticket)
 * C  - Create new ticket
 */
export function useTicketShortcuts(actions: TicketShortcutActions) {
    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            // Don't intercept when user is typing in an input/textarea/select
            const target = event.target as HTMLElement | null;
            const tagName = target?.tagName?.toLowerCase() ?? '';
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
                // Exception: Escape should still work to blur
                if (event.key !== 'Escape') return;
            }

            // Don't intercept when modifier keys are held (except Shift for some)
            if (event.ctrlKey || event.metaKey || event.altKey) return;

            switch (event.key) {
                case '/':
                    event.preventDefault();
                    actions.focusSearch();
                    break;
                case 'f':
                case 'F':
                    event.preventDefault();
                    actions.previousTicket();
                    break;
                case 'j':
                case 'J':
                    event.preventDefault();
                    actions.nextTicket();
                    break;
                case 'r':
                case 'R':
                    event.preventDefault();
                    actions.focusReply();
                    break;
                case 'n':
                case 'N':
                    event.preventDefault();
                    actions.addNote();
                    break;
                case 'e':
                case 'E':
                    event.preventDefault();
                    actions.markAsDone();
                    break;
                case 'c':
                case 'C':
                    event.preventDefault();
                    actions.createTicket();
                    break;
                case 'Escape':
                    // Blur the current element
                    (target as HTMLElement | null)?.blur?.();
                    break;
            }
        },
        [actions],
    );

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
