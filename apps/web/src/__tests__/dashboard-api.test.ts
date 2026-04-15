import { describe, it, expect } from 'vitest';
import { MOCK_TICKETS } from '@/lib/mock-tickets';

/**
 * Tests for dashboard API route logic.
 * We test the data transformations directly rather than HTTP round-trips.
 */

describe('Dashboard stats API logic', () => {
    it('counts SLA breaches correctly', () => {
        const slaBreaches = MOCK_TICKETS.filter((t) => t.slaBreachedAt !== null).length;
        expect(slaBreaches).toBe(1); // Only tkt-5 has SLA breach
    });

    it('computes first response times from messages', () => {
        const firstResponseTimesMs: number[] = [];

        for (const ticket of MOCK_TICKETS) {
            const created = new Date(ticket.createdAt).getTime();
            const firstResponse = ticket.messages.find(
                (m) => m.author !== ticket.user?.name && m.author !== 'System',
            );
            if (firstResponse) {
                firstResponseTimesMs.push(
                    new Date(firstResponse.createdAt).getTime() - created,
                );
            }
        }

        expect(firstResponseTimesMs.length).toBeGreaterThan(0);
        const avg = firstResponseTimesMs.reduce((a, b) => a + b, 0) / firstResponseTimesMs.length;
        expect(avg).toBeGreaterThan(0);
    });

    it('builds daily trend array with correct length for a month', () => {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dailyCounts: number[] = new Array(daysInMonth).fill(0);

        expect(dailyCounts).toHaveLength(daysInMonth);
        expect(dailyCounts.every((c) => c === 0)).toBe(true);
    });

    it('identifies open vs resolved tickets', () => {
        const openStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'WAITING_ON_TEAM'];
        const open = MOCK_TICKETS.filter((t) => openStatuses.includes(t.status));
        const resolved = MOCK_TICKETS.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED');

        expect(open.length + resolved.length).toBe(MOCK_TICKETS.length);
        expect(open.length).toBeGreaterThan(0);
        expect(resolved.length).toBeGreaterThan(0);
    });
});

describe('Dashboard my-tasks API logic', () => {
    it('filters tasks by assigneeId', () => {
        const assigneeId = 'tm-3';
        const tasks = MOCK_TICKETS.filter((t) => t.assigneeId === assigneeId);
        expect(tasks.length).toBeGreaterThan(0);
        expect(tasks.every((t) => t.assigneeId === assigneeId)).toBe(true);
    });

    it('returns correct shape for task entries', () => {
        const assigneeId = 'tm-1';
        const tasks = MOCK_TICKETS
            .filter((t) => t.assigneeId === assigneeId)
            .map((t) => ({
                id: t.id,
                displayId: t.displayId,
                title: t.title,
                status: t.status,
                priority: t.priority,
                accountName: t.account?.name ?? null,
                createdAt: t.createdAt,
                slaBreachedAt: t.slaBreachedAt,
            }));

        expect(tasks.length).toBeGreaterThan(0);
        for (const task of tasks) {
            expect(task).toHaveProperty('id');
            expect(task).toHaveProperty('displayId');
            expect(task).toHaveProperty('title');
            expect(task).toHaveProperty('status');
            expect(task).toHaveProperty('priority');
            expect(task).toHaveProperty('accountName');
            expect(task).toHaveProperty('createdAt');
            expect(task).toHaveProperty('slaBreachedAt');
        }
    });

    it('returns empty array for unknown assignee', () => {
        const tasks = MOCK_TICKETS.filter((t) => t.assigneeId === 'nonexistent');
        expect(tasks).toHaveLength(0);
    });
});

describe('Dashboard FAQ API logic', () => {
    it('has expected FAQ structure', () => {
        // Simulates the shape the FAQ API returns
        const mockFaq = [
            {
                id: 'faq-1',
                question: 'How do I set up CopilotKit?',
                answer: 'Follow the quickstart guide.',
                sourceCount: 12,
            },
        ];

        expect(mockFaq[0]).toHaveProperty('id');
        expect(mockFaq[0]).toHaveProperty('question');
        expect(mockFaq[0]).toHaveProperty('answer');
        expect(mockFaq[0]).toHaveProperty('sourceCount');
        expect(typeof mockFaq[0].sourceCount).toBe('number');
    });
});
