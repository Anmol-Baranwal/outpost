import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma, BroadcastStatus } from '@copilotkit/outpost/db';

const MAX_BROADCAST_LENGTH = 500;

/**
 * GET /api/broadcasts
 *
 * List broadcasts with optional status filter.
 * Query params: status (DRAFT | SENT)
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status')?.toUpperCase() as BroadcastStatus | null;

    const where: Prisma.BroadcastWhereInput = {};
    if (status && (status === 'DRAFT' || status === 'SENT')) {
        where.status = status;
    }

    const broadcasts = await prisma.broadcast.findMany({
        where,
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ broadcasts, total: broadcasts.length });
}

/**
 * POST /api/broadcasts
 *
 * Create a new broadcast (draft or send immediately).
 * Body: { message, status?, audience?, targetAccounts?, sendAs? }
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

        const status: BroadcastStatus = body.status === 'SENT' ? 'SENT' : 'DRAFT';
        const audience = body.audience || 'ALL_ACCOUNTS';

        const newBroadcast = await prisma.broadcast.create({
            data: {
                message: body.message,
                sendAs: body.sendAs || null,
                audience,
                targetAccounts: body.targetAccounts || null,
                status,
                sentAt: status === 'SENT' ? new Date() : null,
            },
        });

        return NextResponse.json(newBroadcast, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
