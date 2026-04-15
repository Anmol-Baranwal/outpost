import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: mockPush,
        back: vi.fn(),
        forward: vi.fn(),
        refresh: vi.fn(),
        replace: vi.fn(),
        prefetch: vi.fn(),
    }),
}));

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...opts,
    });
    window.dispatchEvent(event);
}

describe('useKeyboardShortcuts', () => {
    beforeEach(() => {
        mockPush.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('navigates to tickets on "c" key', () => {
        renderHook(() => useKeyboardShortcuts());
        fireKey('c');
        expect(mockPush).toHaveBeenCalledWith('/tickets?action=create');
    });

    it('navigates to broadcasts on "b" key', () => {
        renderHook(() => useKeyboardShortcuts());
        fireKey('b');
        expect(mockPush).toHaveBeenCalledWith('/broadcasts?action=create');
    });

    it('does not fire when Ctrl is held', () => {
        renderHook(() => useKeyboardShortcuts());
        fireKey('c', { ctrlKey: true });
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not fire when Meta is held', () => {
        renderHook(() => useKeyboardShortcuts());
        fireKey('b', { metaKey: true });
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not fire when input is focused', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        renderHook(() => useKeyboardShortcuts());
        fireKey('c');
        expect(mockPush).not.toHaveBeenCalled();

        document.body.removeChild(input);
    });

    it('accepts custom shortcuts', () => {
        const handler = vi.fn();
        renderHook(() =>
            useKeyboardShortcuts([{ key: 'x', handler }])
        );
        fireKey('x');
        expect(handler).toHaveBeenCalled();
    });
});
