import { NextResponse } from 'next/server';
import { getUnresolvedConflicts } from '@/lib/mock-sync';

/**
 * GET /api/sync/conflicts
 *
 * Returns unresolved sync conflicts (SyncEvents with status='conflict' and no resolvedAt).
 */
export async function GET() {
    const conflicts = getUnresolvedConflicts();
    return NextResponse.json({ conflicts, total: conflicts.length });
}
