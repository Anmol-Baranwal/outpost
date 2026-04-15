import { describe, it, expect } from 'vitest';
import {
    MOCK_TICKETS,
    filterMockTickets,
    findMockTicket,
} from '@/lib/mock-tickets';
import { TicketStatus, TicketPriority } from '@outpost/shared';

describe('Ticket API logic', () => {
    describe('filterMockTickets', () => {
        it('returns all tickets when no filters are applied', () => {
            const result = filterMockTickets({});
            expect(result).toHaveLength(MOCK_TICKETS.length);
        });

        it('filters by status', () => {
            const result = filterMockTickets({ status: [TicketStatus.OPEN] });
            expect(result.every((t) => t.status === TicketStatus.OPEN)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        it('filters by multiple statuses', () => {
            const result = filterMockTickets({
                status: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
            });
            expect(
                result.every(
                    (t) =>
                        t.status === TicketStatus.OPEN ||
                        t.status === TicketStatus.IN_PROGRESS,
                ),
            ).toBe(true);
        });

        it('filters by priority', () => {
            const result = filterMockTickets({ priority: [TicketPriority.HIGH] });
            expect(result.every((t) => t.priority === TicketPriority.HIGH)).toBe(true);
        });

        it('filters by search term matching title', () => {
            const result = filterMockTickets({ search: 'CopilotRuntime' });
            expect(result.length).toBeGreaterThan(0);
            expect(result[0].title).toContain('CopilotRuntime');
        });

        it('filters by search term matching account name', () => {
            const result = filterMockTickets({ search: 'Acme' });
            expect(result.length).toBeGreaterThan(0);
            expect(result.every((t) => t.account?.name === 'Acme Corp')).toBe(true);
        });

        it('filters by accountId', () => {
            const result = filterMockTickets({ accountId: 'acc-1' });
            expect(result.every((t) => t.accountId === 'acc-1')).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        it('filters by assigneeId', () => {
            const result = filterMockTickets({ assigneeId: 'tm-1' });
            expect(result.every((t) => t.assigneeId === 'tm-1')).toBe(true);
        });

        it('returns empty for non-matching filters', () => {
            const result = filterMockTickets({ search: 'zzzznonexistent' });
            expect(result).toHaveLength(0);
        });

        it('combines multiple filters with AND logic', () => {
            const result = filterMockTickets({
                status: [TicketStatus.OPEN],
                priority: [TicketPriority.CRITICAL],
            });
            expect(
                result.every(
                    (t) =>
                        t.status === TicketStatus.OPEN &&
                        t.priority === TicketPriority.CRITICAL,
                ),
            ).toBe(true);
        });
    });

    describe('findMockTicket', () => {
        it('finds ticket by internal ID', () => {
            const ticket = findMockTicket('tkt-1');
            expect(ticket).toBeDefined();
            expect(ticket?.id).toBe('tkt-1');
        });

        it('finds ticket by display ID', () => {
            const ticket = findMockTicket('TKT-A7B3');
            expect(ticket).toBeDefined();
            expect(ticket?.displayId).toBe('TKT-A7B3');
        });

        it('returns undefined for non-existent ID', () => {
            const ticket = findMockTicket('nonexistent');
            expect(ticket).toBeUndefined();
        });
    });
});
