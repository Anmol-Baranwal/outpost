import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';

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
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

        const event = await prisma.syncEvent.findUnique({ where: { id } });

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

        // Mark as resolved, recording the chosen resolution for audit trail.
        // SyncEvent has no dedicated resolution field, so we store it in error
        // (which is nullable and otherwise unused for successful events).
        const updated = await prisma.syncEvent.update({
            where: { id },
            data: {
                status: 'success',
                error: JSON.stringify({ resolution, resolvedAt: new Date().toISOString() }),
            },
        });

        return NextResponse.json({
            success: true,
            resolution,
            event: updated,
        });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
