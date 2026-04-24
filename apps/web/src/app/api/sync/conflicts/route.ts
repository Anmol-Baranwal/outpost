import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/sync/conflicts
 *
 * Returns unresolved sync conflicts (SyncEvents with status='conflict').
 */
export async function GET() {
    const conflicts = await prisma.syncEvent.findMany({
        where: { status: 'conflict' },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ conflicts, total: conflicts.length });
}
