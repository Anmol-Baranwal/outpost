import { describe, it, expect } from 'vitest';
import {
    currentMonthKey,
    isValidMonthKey,
    monthWindow,
    monthLabel,
    listMonths,
    resolveMonthKey,
    defaultMonthKey,
} from '@/lib/month-window';

describe('month-window', () => {
    describe('currentMonthKey', () => {
        it('formats the given date as YYYY-MM', () => {
            expect(currentMonthKey(new Date(2026, 6, 31))).toBe('2026-07');
        });

        it('zero-pads single-digit months', () => {
            expect(currentMonthKey(new Date(2026, 0, 5))).toBe('2026-01');
        });
    });

    describe('isValidMonthKey', () => {
        it('accepts a well-formed key', () => {
            expect(isValidMonthKey('2026-07')).toBe(true);
        });

        it('rejects month 00 and month 13', () => {
            expect(isValidMonthKey('2026-00')).toBe(false);
            expect(isValidMonthKey('2026-13')).toBe(false);
        });

        it('rejects garbage, wrong shapes, and non-strings', () => {
            expect(isValidMonthKey('garbage')).toBe(false);
            expect(isValidMonthKey('2026-7')).toBe(false);
            expect(isValidMonthKey('26-07')).toBe(false);
            expect(isValidMonthKey('2026-07-01')).toBe(false);
            expect(isValidMonthKey('')).toBe(false);
            expect(isValidMonthKey(null)).toBe(false);
            expect(isValidMonthKey(7)).toBe(false);
        });
    });

    describe('monthWindow', () => {
        it('spans the first millisecond to the last of the month', () => {
            const { start, end } = monthWindow('2026-07');
            expect(start.getTime()).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime());
            expect(end.getTime()).toBe(new Date(2026, 6, 31, 23, 59, 59, 999).getTime());
        });

        it('reports days in month, including February in a leap year', () => {
            expect(monthWindow('2026-07').daysInMonth).toBe(31);
            expect(monthWindow('2026-06').daysInMonth).toBe(30);
            expect(monthWindow('2026-02').daysInMonth).toBe(28);
            expect(monthWindow('2024-02').daysInMonth).toBe(29);
        });

        it('handles December without rolling into the wrong year', () => {
            const { start, end, daysInMonth } = monthWindow('2026-12');
            expect(start.getFullYear()).toBe(2026);
            expect(start.getMonth()).toBe(11);
            expect(end.getFullYear()).toBe(2026);
            expect(end.getMonth()).toBe(11);
            expect(end.getDate()).toBe(31);
            expect(daysInMonth).toBe(31);
        });
    });

    describe('monthLabel', () => {
        it('renders month name and year', () => {
            expect(monthLabel('2026-07')).toBe('July 2026');
            expect(monthLabel('2026-01')).toBe('January 2026');
        });
    });

    describe('listMonths', () => {
        it('spans oldest through now, ascending, with no gaps', () => {
            const months = listMonths(new Date(2026, 4, 20), new Date(2026, 6, 31));
            expect(months).toEqual(['2026-05', '2026-06', '2026-07']);
        });

        it('crosses a year boundary', () => {
            const months = listMonths(new Date(2025, 10, 2), new Date(2026, 1, 15));
            expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
        });

        it('returns just the current month when oldest is in it', () => {
            expect(listMonths(new Date(2026, 6, 1), new Date(2026, 6, 31))).toEqual(['2026-07']);
        });

        it('returns just the current month when there is no oldest ticket', () => {
            expect(listMonths(null, new Date(2026, 6, 31))).toEqual(['2026-07']);
        });
    });

    describe('defaultMonthKey', () => {
        it('returns the month of the newest ticket, not the calendar month', () => {
            // Newest ticket is in July; "today" is early August. Defaulting to
            // August would open the dashboard on an empty chart reading 0.
            expect(defaultMonthKey(new Date(2026, 6, 30), new Date(2026, 7, 3))).toBe('2026-07');
        });

        it('returns the current month when there are no tickets at all', () => {
            expect(defaultMonthKey(null, new Date(2026, 7, 3))).toBe('2026-08');
        });

        it('returns the current month when the newest ticket is in it', () => {
            expect(defaultMonthKey(new Date(2026, 7, 1), new Date(2026, 7, 3))).toBe('2026-08');
        });
    });

    describe('resolveMonthKey', () => {
        const oldest = new Date(2026, 5, 4);
        const newest = new Date(2026, 6, 30);
        const now = new Date(2026, 7, 3);

        it('accepts a valid in-range key', () => {
            expect(resolveMonthKey('2026-06', oldest, newest, now)).toBe('2026-06');
        });

        it('accepts the current month even when it has no tickets', () => {
            // Selecting an empty month is a deliberate choice; only the
            // DEFAULT avoids landing there.
            expect(resolveMonthKey('2026-08', oldest, newest, now)).toBe('2026-08');
        });

        it('defaults to the newest month with tickets for a malformed key', () => {
            expect(resolveMonthKey('garbage', oldest, newest, now)).toBe('2026-07');
            expect(resolveMonthKey('2026-13', oldest, newest, now)).toBe('2026-07');
        });

        it('defaults to the newest month with tickets when no key is given', () => {
            expect(resolveMonthKey(null, oldest, newest, now)).toBe('2026-07');
        });

        it('falls back for a month before the first ticket', () => {
            expect(resolveMonthKey('2026-01', oldest, newest, now)).toBe('2026-07');
        });

        it('falls back for a future month', () => {
            expect(resolveMonthKey('2026-12', oldest, newest, now)).toBe('2026-07');
        });

        it('falls back to the current month when there are no tickets at all', () => {
            expect(resolveMonthKey(null, null, null, now)).toBe('2026-08');
        });
    });
});
