import { NextResponse } from 'next/server';
import { MOCK_SYSTEM_STATUS } from '@/lib/mock-sync';

/**
 * GET /api/sync/status
 *
 * Returns per-system sync health metrics.
 */
export async function GET() {
    return NextResponse.json({ systems: MOCK_SYSTEM_STATUS });
}
