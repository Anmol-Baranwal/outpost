import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';
import { computeFunnelMetrics } from '@copilotkit/outpost/shared';
import type { OnboardingMember } from '@copilotkit/outpost/shared';

/**
 * GET /api/onboarding/metrics
 *
 * Return funnel metrics. Accepts optional date range query params.
 */
export async function GET(request: NextRequest) {
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

    const members = await prisma.onboardingMember.findMany({ where });

    // Map Prisma records to the shape expected by computeFunnelMetrics.
    // Cast funnelStage since Prisma's enum and shared's enum are structurally
    // identical but nominally distinct.
    const mapped: OnboardingMember[] = members.map((m: typeof members[number]) => ({
        id: m.id,
        discordId: m.discordId,
        username: m.username,
        joinedAt: m.joinedAt.toISOString(),
        funnelStage: m.funnelStage as unknown as OnboardingMember['funnelStage'],
        contacted: m.contacted,
        responded: m.responded,
        meetingBooked: m.meetingBooked,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
    }));

    const metrics = computeFunnelMetrics(mapped);

    return NextResponse.json(metrics);
}
