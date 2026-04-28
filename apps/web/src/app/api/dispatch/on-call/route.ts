import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { peekOnCall, getOnCallMembers } from '@copilotkit/outpost/shared';

/**
 * GET /api/dispatch/on-call
 *
 * Returns the current on-call team member and the full rotation list.
 * Does not advance the rotation (uses peek).
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const members = getOnCallMembers();
    const currentOnCall = await peekOnCall(members, prisma);

    return NextResponse.json({
        currentOnCall,
        members,
        configured: members.length > 0,
    });
}
