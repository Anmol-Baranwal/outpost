import { NextRequest, NextResponse } from 'next/server';
import { findMockTicket } from '@/lib/mock-tickets';
import { MessageType } from '@copilotkit/outpost-shared';

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
    const { id } = await params;
    const ticket = findMockTicket(id);

    if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    try {
        const body = await request.json();

        if (!body.content) {
            return NextResponse.json(
                { error: 'content is required' },
                { status: 400 },
            );
        }

        const message = {
            id: `msg-${Date.now()}`,
            ticketId: id,
            author: body.author || 'Unknown',
            content: body.content,
            type: (body.type as MessageType) || MessageType.USER,
            isAiGenerated: body.isAiGenerated || false,
            attachments: body.attachments || null,
            createdAt: new Date().toISOString(),
        };

        // In production, this would use prisma.message.create()
        return NextResponse.json(message, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
