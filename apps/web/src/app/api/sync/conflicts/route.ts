import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/sync/conflicts
 *
 * Returns unresolved sync conflicts (SyncEvents with status='conflict').
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const conflicts = await prisma.syncEvent.findMany({
        where: { status: 'conflict' },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ conflicts, total: conflicts.length });
}
