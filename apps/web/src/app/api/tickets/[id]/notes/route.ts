import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

/**
 * POST /api/tickets/[id]/notes
 *
 * Add a note to a ticket. Required field: content.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
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

    try {
        const body = await request.json();

        if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
            return NextResponse.json(
                { error: 'content is required' },
                { status: 400 },
            );
        }

        const note = await prisma.note.create({
            data: {
                ticketId: ticket.id,
                author: body.author || 'Unknown',
                content: body.content.trim(),
            },
        });

        return NextResponse.json(note, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
