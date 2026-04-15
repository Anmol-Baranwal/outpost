import { NextRequest, NextResponse } from 'next/server';
import { findMockTicket } from '@/lib/mock-tickets';
import { TicketStatus, TicketPriority, TicketType } from '@outpost/shared';

/**
 * GET /api/tickets/[id]
 *
 * Get a single ticket with its messages, notes, and related data.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ticket = findMockTicket(id);

    if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json(ticket);
}

/**
 * PATCH /api/tickets/[id]
 *
 * Update ticket fields: status, priority, assigneeId, type.
 */
export async function PATCH(
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
        const allowedFields = ['status', 'priority', 'assigneeId', 'type'];
        const updates: Record<string, string | null> = {};

        for (const field of allowedFields) {
            if (field in body) {
                // Validate enum values
                if (field === 'status' && !Object.values(TicketStatus).includes(body[field])) {
                    return NextResponse.json(
                        { error: `Invalid status: ${body[field]}` },
                        { status: 400 },
                    );
                }
                if (field === 'priority' && !Object.values(TicketPriority).includes(body[field])) {
                    return NextResponse.json(
                        { error: `Invalid priority: ${body[field]}` },
                        { status: 400 },
                    );
                }
                if (field === 'type' && !Object.values(TicketType).includes(body[field])) {
                    return NextResponse.json(
                        { error: `Invalid type: ${body[field]}` },
                        { status: 400 },
                    );
                }
                updates[field] = body[field];
            }
        }

        // In production, this would use prisma.ticket.update()
        const updatedTicket = { ...ticket, ...updates, updatedAt: new Date().toISOString() };
        return NextResponse.json(updatedTicket);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
