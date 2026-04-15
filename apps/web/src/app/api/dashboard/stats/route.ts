import { NextResponse } from 'next/server';
import { MOCK_TICKETS } from '@/lib/mock-tickets';
import { TicketStatus } from '@outpost/shared';

/**
 * GET /api/dashboard/stats
 *
 * Returns SLA metrics, ticket counts, and daily trend data for the current month.
 */
export async function GET() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // SLA breach count
    const slaBreaches = MOCK_TICKETS.filter((t) => t.slaBreachedAt !== null).length;

    // Compute average first response time from mock data (time between ticket creation
    // and first non-system, non-user message). For demo purposes we'll derive plausible values.
    const firstResponseTimesMs: number[] = [];
    const resolutionTimesMs: number[] = [];

    for (const ticket of MOCK_TICKETS) {
        const created = new Date(ticket.createdAt).getTime();

        // First response = first agent/bot reply after creation
        const firstResponse = ticket.messages.find(
            (m) => m.author !== ticket.user?.name && m.author !== 'System',
        );
        if (firstResponse) {
            firstResponseTimesMs.push(
                new Date(firstResponse.createdAt).getTime() - created,
            );
        }

        // Resolution time for resolved tickets
        if (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED) {
            resolutionTimesMs.push(
                new Date(ticket.updatedAt).getTime() - created,
            );
        }
    }

    const avgFirstResponseMs =
        firstResponseTimesMs.length > 0
            ? firstResponseTimesMs.reduce((a, b) => a + b, 0) / firstResponseTimesMs.length
            : 0;

    const avgResolutionMs =
        resolutionTimesMs.length > 0
            ? resolutionTimesMs.reduce((a, b) => a + b, 0) / resolutionTimesMs.length
            : 0;

    // Build daily trend for the current month
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const dailyCounts: number[] = new Array(daysInMonth).fill(0);

    for (const ticket of MOCK_TICKETS) {
        const d = new Date(ticket.createdAt);
        if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
            dailyCounts[d.getDate() - 1]++;
        }
    }

    const trend = dailyCounts.map((count, i) => ({
        day: i + 1,
        count,
    }));

    const totalTickets = MOCK_TICKETS.length;
    const openTickets = MOCK_TICKETS.filter(
        (t) =>
            t.status === TicketStatus.OPEN ||
            t.status === TicketStatus.IN_PROGRESS ||
            t.status === TicketStatus.WAITING_ON_CUSTOMER ||
            t.status === TicketStatus.WAITING_ON_TEAM,
    ).length;

    return NextResponse.json({
        slaBreaches,
        avgFirstResponseMs,
        avgResolutionMs,
        totalTickets,
        openTickets,
        trend,
        month: now.toLocaleString('en-US', { month: 'long' }),
        year: currentYear,
    });
}
