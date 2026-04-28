import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { MessageType } from '@copilotkit/outpost/db';

/**
 * GET /api/tickets/[id]/messages
 *
 * List all messages for a ticket.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        // Support both UUID and displayId lookups (matching parent ticket route)
        const ticket = await prisma.ticket.findFirst({
            where: {
                OR: [{ id }, { displayId: id }],
            },
        });

        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const messages = await prisma.message.findMany({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: 'asc' },
        });

        return NextResponse.json({ messages });
    } catch (error) {
        console.error('[GET /api/tickets/[id]/messages] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}

/**
 * POST /api/tickets/[id]/messages
 *
 * Add a message to a ticket.
 * Required: content. Optional: author, type, isAiGenerated, attachments.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        // Support both UUID and displayId lookups (matching parent ticket route)
        const ticket = await prisma.ticket.findFirst({
            where: {
                OR: [{ id }, { displayId: id }],
            },
        });

        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const body = await request.json();

        if (!body.content) {
            return NextResponse.json(
                { error: 'content is required' },
                { status: 400 },
            );
        }

        const message = await prisma.message.create({
            data: {
                ticketId: ticket.id,
                author: body.author || 'Unknown',
                content: body.content,
                type: (body.type as MessageType) || MessageType.USER,
                isAiGenerated: body.isAiGenerated || false,
                attachments: body.attachments || undefined,
            },
        });

        return NextResponse.json(message, { status: 201 });
    } catch (error) {
        console.error('[POST /api/tickets/[id]/messages] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json(
                { error: 'Invalid request body' },
                { status: 400 },
            );
        }
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}
