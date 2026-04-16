import { NextRequest, NextResponse } from 'next/server';
import { MOCK_SYNC_EVENTS } from '@/lib/mock-sync';

/**
 * POST /api/sync/conflicts/[id]/resolve
 *
 * Resolve a sync conflict by accepting the outpost or external value.
 * Body: { resolution: 'outpost' | 'external' }
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    try {
        const body = await request.json();
        const resolution = body.resolution;

        if (resolution !== 'outpost' && resolution !== 'external') {
            return NextResponse.json(
                { error: 'resolution must be "outpost" or "external"' },
                { status: 400 },
            );
        }

        const event = MOCK_SYNC_EVENTS.find((e) => e.id === id);
        if (!event) {
            return NextResponse.json(
                { error: 'Conflict not found' },
                { status: 404 },
            );
        }

        if (event.status !== 'conflict') {
            return NextResponse.json(
                { error: 'Event is not a conflict' },
                { status: 400 },
            );
        }

        // In a real implementation this would update the ticket and create a new SyncEvent.
        // For mock purposes, mark it resolved.
        event.resolvedAt = new Date().toISOString();
        event.status = 'success';

        return NextResponse.json({
            success: true,
            resolution,
            event,
        });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
