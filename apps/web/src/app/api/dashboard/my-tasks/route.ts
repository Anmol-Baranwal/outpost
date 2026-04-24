import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus } from '@copilotkit/outpost/db';

/**
 * GET /api/dashboard/my-tasks
 *
 * Returns tickets assigned to the current user (from session).
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 },
            );
        }

        const memberId = (session.user as Record<string, unknown>).memberId as string;

        if (!memberId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 },
            );
        }

        const tickets = await prisma.ticket.findMany({
            where: {
                assigneeId: memberId,
                status: {
                    in: [
                        TicketStatus.OPEN,
                        TicketStatus.IN_PROGRESS,
                        TicketStatus.WAITING_ON_TEAM,
                    ],
                },
            },
            include: {
                account: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const tasks = tickets.map((t: typeof tickets[number]) => ({
            id: t.id,
            displayId: t.displayId,
            title: t.title,
            status: t.status,
            priority: t.priority,
            accountName: t.account?.name ?? null,
            createdAt: t.createdAt,
            slaBreachedAt: t.slaBreachedAt,
        }));

        return NextResponse.json({ tasks });
    } catch (error) {
        console.error('[GET /api/dashboard/my-tasks] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}
