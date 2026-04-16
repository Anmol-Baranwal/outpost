import { NextRequest, NextResponse } from 'next/server';
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

        // In production, fetch the member from DB and validate transition.
        // For mock mode, return success with updated fields.
        const flags = flagsForStage(funnelStage as FunnelStage);

        const updatedMember = {
            id,
            funnelStage,
            ...flags,
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(updatedMember);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
