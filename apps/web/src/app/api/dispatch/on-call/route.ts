import { NextResponse } from 'next/server';
import { peekOnCall, getOnCallMembers } from '@copilotkit/outpost-shared';

/**
 * GET /api/dispatch/on-call
 *
 * Returns the current on-call team member and the full rotation list.
 * Does not advance the rotation (uses peek).
 */
export async function GET() {
    const members = getOnCallMembers();
    const currentOnCall = peekOnCall(members);

    return NextResponse.json({
        currentOnCall,
        members,
        configured: members.length > 0,
    });
}
