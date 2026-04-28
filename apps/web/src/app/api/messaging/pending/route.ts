import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

/**
 * GET /api/messaging/pending
 *
 * Returns all pending customer messages across Slack Connect and MS Teams.
 *
 * Note: There is no Prisma model for pending messages yet (Slack/Teams
 * messages are handled by their respective bots). This endpoint returns
 * an empty list until a messaging model is added to the schema.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
        messages: [],
        count: 0,
    });
}
