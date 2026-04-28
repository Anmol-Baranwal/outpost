import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus, MessageType } from '@copilotkit/outpost/db';

/**
 * GET /api/dashboard/stats
 *
 * Returns SLA metrics, ticket counts, and daily trend data for the current month.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const monthStart = new Date(currentYear, currentMonth, 1);
        const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

        // Run aggregate queries in parallel
        const [
            totalTickets,
            openTickets,
            slaBreaches,
            ticketsWithFirstResponse,
            resolvedTickets,
            monthlyTickets,
        ] = await Promise.all([
            prisma.ticket.count(),
            prisma.ticket.count({
                where: {
                    status: {
                        in: [
                            TicketStatus.OPEN,
                            TicketStatus.IN_PROGRESS,
                            TicketStatus.WAITING_ON_CUSTOMER,
                            TicketStatus.WAITING_ON_TEAM,
                        ],
                    },
                },
            }),
            prisma.ticket.count({
                where: { slaBreachedAt: { not: null } },
            }),
            // Get tickets with their first non-system, non-user-authored message for avg first response
            prisma.ticket.findMany({
                select: {
                    createdAt: true,
                    user: { select: { name: true } },
                    messages: {
                        where: {
                            type: { not: MessageType.SYSTEM },
                        },
                        orderBy: { createdAt: 'asc' },
                        take: 5, // Take a few to find the first agent/bot reply
                    },
                },
            }),
            // Resolved/closed tickets for avg resolution time
            prisma.ticket.findMany({
                where: {
                    status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
                },
                select: {
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            // Monthly tickets for trend
            prisma.ticket.findMany({
                where: {
                    createdAt: {
                        gte: monthStart,
                        lte: monthEnd,
                    },
                },
                select: { createdAt: true },
            }),
        ]);

        // Compute avg first response time
        const firstResponseTimesMs: number[] = [];
        for (const ticket of ticketsWithFirstResponse) {
            const created = ticket.createdAt.getTime();
            // First response = first message that isn't from the user or system
            const firstResponse = ticket.messages.find(
                (m: { type: string; createdAt: Date }) => m.type !== 'USER' && m.type !== 'SYSTEM',
            );
            if (firstResponse) {
                firstResponseTimesMs.push(firstResponse.createdAt.getTime() - created);
            }
        }

        const avgFirstResponseMs =
            firstResponseTimesMs.length > 0
                ? firstResponseTimesMs.reduce((a, b) => a + b, 0) / firstResponseTimesMs.length
                : 0;

        // Compute avg resolution time
        const resolutionTimesMs: number[] = [];
        for (const ticket of resolvedTickets) {
            resolutionTimesMs.push(ticket.updatedAt.getTime() - ticket.createdAt.getTime());
        }

        const avgResolutionMs =
            resolutionTimesMs.length > 0
                ? resolutionTimesMs.reduce((a, b) => a + b, 0) / resolutionTimesMs.length
                : 0;

        // Build daily trend for current month
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const dailyCounts: number[] = new Array(daysInMonth).fill(0);

        for (const ticket of monthlyTickets) {
            const d = ticket.createdAt;
            if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
                dailyCounts[d.getDate() - 1]++;
            }
        }

        const trend = dailyCounts.map((count, i) => ({
            day: i + 1,
            count,
        }));

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
    } catch (error) {
        console.error('[GET /api/dashboard/stats] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}
