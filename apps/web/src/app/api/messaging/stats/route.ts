import { NextResponse } from 'next/server';

/**
 * GET /api/messaging/stats
 *
 * Returns messaging statistics: total pending, overdue count, source breakdown.
 *
 * Note: There is no Prisma model for pending messages yet (Slack/Teams
 * messages are handled externally). This endpoint returns sensible defaults
 * until a messaging model is added to the schema.
 */
export async function GET() {
    return NextResponse.json({
        totalPending: 0,
        overdueCount: 0,
        slackCount: 0,
        teamsCount: 0,
        avgResponseTimeMs: 0,
    });
}
