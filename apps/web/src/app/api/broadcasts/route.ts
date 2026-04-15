import { NextRequest, NextResponse } from 'next/server';
import {
    filterMockBroadcasts,
    MOCK_BROADCASTS,
    MAX_BROADCAST_LENGTH,
} from '@/lib/mock-broadcasts';
import { MOCK_TEAM_MEMBERS, MOCK_ACCOUNTS } from '@/lib/mock-tickets';
import type { BroadcastStatus } from '@/lib/mock-broadcasts';

/**
 * GET /api/broadcasts
 *
 * List broadcasts with optional status filter.
 * Query params: status (draft | sent)
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') as BroadcastStatus | null;

    const broadcasts = filterMockBroadcasts(
        status ? { status } : {},
    );

    return NextResponse.json({ broadcasts, total: broadcasts.length });
}

/**
 * POST /api/broadcasts
 *
 * Create a new broadcast (draft or send immediately).
 * Body: { message, status, audienceType, audienceAccountIds, senderId }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.message || typeof body.message !== 'string') {
            return NextResponse.json(
                { error: 'message is required' },
                { status: 400 },
            );
        }

        if (body.message.length > MAX_BROADCAST_LENGTH) {
            return NextResponse.json(
                { error: `message exceeds ${MAX_BROADCAST_LENGTH} character limit` },
                { status: 400 },
            );
        }

        const status: BroadcastStatus = body.status === 'sent' ? 'sent' : 'draft';
        const audienceType = body.audienceType === 'specific' ? 'specific' as const : 'all' as const;
        const audienceAccountIds: string[] = audienceType === 'specific'
            ? (body.audienceAccountIds || [])
            : [];

        if (audienceType === 'specific' && audienceAccountIds.length === 0) {
            return NextResponse.json(
                { error: 'at least one account must be selected for specific audience' },
                { status: 400 },
            );
        }

        const sender = MOCK_TEAM_MEMBERS.find((tm) => tm.id === body.senderId);
        if (!sender) {
            return NextResponse.json(
                { error: 'invalid senderId' },
                { status: 400 },
            );
        }

        const audienceAccounts = audienceAccountIds
            .map((id: string) => MOCK_ACCOUNTS.find((a) => a.id === id))
            .filter(Boolean);

        const now = new Date().toISOString();

        const newBroadcast = {
            id: `bc-${Date.now()}`,
            message: body.message,
            status,
            audienceType,
            audienceAccountIds,
            audienceAccounts,
            senderId: sender.id,
            sender,
            createdAt: now,
            sentAt: status === 'sent' ? now : null,
        };

        return NextResponse.json(newBroadcast, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
