import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

const MAX_BROADCAST_LENGTH = 500;

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
    const broadcast = await prisma.broadcast.findUnique({ where: { id } });

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
 * Body: { message?, audience?, targetAccounts?, sendAs? }
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const broadcast = await prisma.broadcast.findUnique({ where: { id } });

    if (!broadcast) {
        return NextResponse.json(
            { error: 'Broadcast not found' },
            { status: 404 },
        );
    }

    if (broadcast.status !== 'DRAFT') {
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

        const data: Record<string, unknown> = {};
        if (body.message !== undefined) data.message = body.message;
        if (body.audience !== undefined) data.audience = body.audience;
        if (body.targetAccounts !== undefined) data.targetAccounts = body.targetAccounts;
        if (body.sendAs !== undefined) data.sendAs = body.sendAs;

        const updated = await prisma.broadcast.update({
            where: { id },
            data,
        });

        return NextResponse.json(updated);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
