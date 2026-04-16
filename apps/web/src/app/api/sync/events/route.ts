import { NextRequest, NextResponse } from 'next/server';
import { filterSyncEvents } from '@/lib/mock-sync';
import type { SyncEventStatus } from '@/lib/mock-sync';

/**
 * GET /api/sync/events
 *
 * Paginated sync event audit log with optional filters.
 * Query params: sourcePlugin, targetPlugin, status, startDate, endDate, page, limit
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;

    const sourcePlugin = searchParams.get('sourcePlugin') || undefined;
    const targetPlugin = searchParams.get('targetPlugin') || undefined;
    const status = (searchParams.get('status') as SyncEventStatus) || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50));

    const allEvents = filterSyncEvents({ sourcePlugin, targetPlugin, status, startDate, endDate });
    const total = allEvents.length;
    const start = (page - 1) * limit;
    const events = allEvents.slice(start, start + limit);

    return NextResponse.json({
        events,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    });
}
