import { NextRequest, NextResponse } from 'next/server';
import { MOCK_TICKETS } from '@/lib/mock-tickets';

/**
 * GET /api/dashboard/my-tasks
 *
 * Returns tickets assigned to the current user.
 * Uses ?assigneeId query param (in production, derived from session).
 * Falls back to 'tm-3' (Jordan Ritter) for demo.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const assigneeId = searchParams.get('assigneeId') || 'tm-3';

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

    return NextResponse.json({ tasks });
}
