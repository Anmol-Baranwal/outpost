'use client';

import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

export function KeyboardShortcutProvider() {
    useKeyboardShortcuts();
    return null;
}
