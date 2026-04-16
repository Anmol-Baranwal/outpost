import { NextRequest, NextResponse } from 'next/server';
import { FunnelStage } from '@copilotkit/outpost-shared';
import type { OnboardingMember } from '@copilotkit/outpost-shared';

/**
 * Mock onboarding members for development.
 * In production these come from Prisma.
 */
const MOCK_MEMBERS: OnboardingMember[] = [
    {
        id: 'om-1',
        discordId: 'discord-001',
        username: 'alice_dev#1234',
        joinedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        funnelStage: FunnelStage.JOINED,
        contacted: false,
        responded: false,
        meetingBooked: false,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
        id: 'om-2',
        discordId: 'discord-002',
        username: 'bob_eng#5678',
        joinedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        funnelStage: FunnelStage.CONTACTED,
        contacted: true,
        responded: false,
        meetingBooked: false,
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    },
    {
        id: 'om-3',
        discordId: 'discord-003',
        username: 'charlie_pm#9012',
        joinedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        funnelStage: FunnelStage.RESPONDED,
        contacted: true,
        responded: true,
        meetingBooked: false,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
        id: 'om-4',
        discordId: 'discord-004',
        username: 'diana_cto#3456',
        joinedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        funnelStage: FunnelStage.MEETING_BOOKED,
        contacted: true,
        responded: true,
        meetingBooked: true,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    },
    {
        id: 'om-5',
        discordId: 'discord-005',
        username: 'eve_design#7890',
        joinedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        funnelStage: FunnelStage.JOINED,
        contacted: false,
        responded: false,
        meetingBooked: false,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
];

/**
 * GET /api/onboarding/members
 *
 * List onboarding members with optional date range filter.
 * Query params: from, to (ISO date strings)
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let members = [...MOCK_MEMBERS];

    if (from) {
        const fromDate = new Date(from);
        members = members.filter((m) => new Date(m.joinedAt) >= fromDate);
    }

    if (to) {
        const toDate = new Date(to);
        members = members.filter((m) => new Date(m.joinedAt) <= toDate);
    }

    // Sort by join date descending (newest first)
    members.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());

    return NextResponse.json({ members, total: members.length });
}
