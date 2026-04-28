import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/onboarding/members
 *
 * List onboarding members with optional date range filter.
 * Query params: from, to (ISO date strings)
 */
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where: Prisma.OnboardingMemberWhereInput = {};

    if (from || to) {
        where.joinedAt = {};
        if (from) {
            where.joinedAt.gte = new Date(from);
        }
        if (to) {
            where.joinedAt.lte = new Date(to);
        }
    }

    const members = await prisma.onboardingMember.findMany({
        where,
        orderBy: { joinedAt: 'desc' },
    });

    return NextResponse.json({ members, total: members.length });
}
