import { NextRequest, NextResponse } from 'next/server';
import { findMockBroadcast, MAX_BROADCAST_LENGTH } from '@/lib/mock-broadcasts';

/**
 * GET /api/broadcasts/[id]
 *
 * Retrieve a single broadcast by ID.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const broadcast = findMockBroadcast(id);

    if (!broadcast) {
        return NextResponse.json(
            { error: 'Broadcast not found' },
            { status: 404 },
        );
    }

    return NextResponse.json(broadcast);
}

/**
 * PATCH /api/broadcasts/[id]
 *
 * Update a draft broadcast. Only drafts can be updated.
 * Body: { message?, audienceType?, audienceAccountIds?, senderId? }
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const broadcast = findMockBroadcast(id);

    if (!broadcast) {
        return NextResponse.json(
            { error: 'Broadcast not found' },
            { status: 404 },
        );
    }

    if (broadcast.status !== 'draft') {
        return NextResponse.json(
            { error: 'Only draft broadcasts can be updated' },
            { status: 400 },
        );
    }

    try {
        const body = await request.json();

        if (body.message !== undefined) {
            if (typeof body.message !== 'string' || body.message.length === 0) {
                return NextResponse.json(
                    { error: 'message must be a non-empty string' },
                    { status: 400 },
                );
            }
            if (body.message.length > MAX_BROADCAST_LENGTH) {
                return NextResponse.json(
                    { error: `message exceeds ${MAX_BROADCAST_LENGTH} character limit` },
                    { status: 400 },
                );
            }
        }

        // In production, this would use prisma.broadcast.update()
        const updated = {
            ...broadcast,
            ...(body.message !== undefined && { message: body.message }),
            ...(body.audienceType !== undefined && { audienceType: body.audienceType }),
            ...(body.audienceAccountIds !== undefined && { audienceAccountIds: body.audienceAccountIds }),
            ...(body.senderId !== undefined && { senderId: body.senderId }),
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(updated);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
