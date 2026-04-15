'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface ShortcutConfig {
    key: string;
    handler: () => void;
    /** If true, fires even when user is in an input/textarea */
    global?: boolean;
}

function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
}

export function useKeyboardShortcuts(shortcuts?: ShortcutConfig[]) {
    const router = useRouter();

    const defaultShortcuts: ShortcutConfig[] = [
        {
            key: '/',
            handler: () => {
                // Focus search bar when it exists — for now, log intent
                const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]');
                if (searchInput) {
                    searchInput.focus();
                }
            },
        },
        {
            key: 'c',
            handler: () => {
                router.push('/tickets?action=create');
            },
        },
        {
            key: 'b',
            handler: () => {
                router.push('/broadcasts?action=create');
            },
        },
    ];

    const allShortcuts = [...defaultShortcuts, ...(shortcuts ?? [])];

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            // Don't fire shortcuts when modifier keys are held (except shift)
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            for (const shortcut of allShortcuts) {
                if (e.key === shortcut.key) {
                    if (!shortcut.global && isInputFocused()) return;
                    e.preventDefault();
                    shortcut.handler();
                    return;
                }
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allShortcuts]
    );

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
