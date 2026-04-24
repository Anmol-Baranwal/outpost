import { NextResponse } from 'next/server';

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
    return NextResponse.json({
        messages: [],
        count: 0,
    });
}
