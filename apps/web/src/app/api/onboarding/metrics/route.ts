import { NextRequest, NextResponse } from 'next/server';
import { FunnelStage, computeFunnelMetrics } from '@outpost/shared';
import type { OnboardingMember } from '@outpost/shared';

/**
 * Mock members for metrics computation.
 * In production these come from Prisma.
 */
const MOCK_ALL_MEMBERS: OnboardingMember[] = [
    { id: 'om-1', discordId: 'd1', username: 'alice', joinedAt: new Date().toISOString(), funnelStage: FunnelStage.JOINED, contacted: false, responded: false, meetingBooked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'om-2', discordId: 'd2', username: 'bob', joinedAt: new Date().toISOString(), funnelStage: FunnelStage.CONTACTED, contacted: true, responded: false, meetingBooked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'om-3', discordId: 'd3', username: 'charlie', joinedAt: new Date().toISOString(), funnelStage: FunnelStage.RESPONDED, contacted: true, responded: true, meetingBooked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'om-4', discordId: 'd4', username: 'diana', joinedAt: new Date().toISOString(), funnelStage: FunnelStage.MEETING_BOOKED, contacted: true, responded: true, meetingBooked: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'om-5', discordId: 'd5', username: 'eve', joinedAt: new Date().toISOString(), funnelStage: FunnelStage.JOINED, contacted: false, responded: false, meetingBooked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

/**
 * GET /api/onboarding/metrics
 *
 * Return funnel metrics. Accepts optional date range query params.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let members = [...MOCK_ALL_MEMBERS];

    if (from) {
        const fromDate = new Date(from);
        members = members.filter((m) => new Date(m.joinedAt) >= fromDate);
    }

    if (to) {
        const toDate = new Date(to);
        members = members.filter((m) => new Date(m.joinedAt) <= toDate);
    }

    const metrics = computeFunnelMetrics(members);

    return NextResponse.json(metrics);
}
