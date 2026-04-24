import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { FunnelStage, isValidTransition, flagsForStage } from '@copilotkit/outpost/shared';

/**
 * PATCH /api/onboarding/members/[id]
 *
 * Update a member's funnel stage. Validates that the transition
 * is forward-only (can't go backwards in the funnel).
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    try {
        const body = await request.json();
        const { funnelStage } = body;

        if (!funnelStage) {
            return NextResponse.json(
                { error: 'funnelStage is required' },
                { status: 400 },
            );
        }

        if (!Object.values(FunnelStage).includes(funnelStage)) {
            return NextResponse.json(
                { error: `Invalid funnel stage: ${funnelStage}` },
                { status: 400 },
            );
        }

        const member = await prisma.onboardingMember.findUnique({
            where: { id },
        });

        if (!member) {
            return NextResponse.json(
                { error: 'Member not found' },
                { status: 404 },
            );
        }

        // Validate forward-only transition
        if (!isValidTransition(member.funnelStage as FunnelStage, funnelStage as FunnelStage)) {
            return NextResponse.json(
                { error: `Invalid transition from ${member.funnelStage} to ${funnelStage}` },
                { status: 400 },
            );
        }

        const flags = flagsForStage(funnelStage as FunnelStage);

        const updated = await prisma.onboardingMember.update({
            where: { id },
            data: {
                funnelStage: funnelStage as FunnelStage,
                ...flags,
            },
        });

        return NextResponse.json(updated);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
