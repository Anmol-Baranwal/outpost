import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus, TicketPriority, TicketType } from '@copilotkit/outpost/db';

/**
 * GET /api/tickets/[id]
 *
 * Get a single ticket with its messages, notes, discussions, and related data.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;

        const ticket = await prisma.ticket.findFirst({
            where: {
                OR: [{ id }, { displayId: id }],
            },
            include: {
                account: true,
                user: true,
                assignee: true,
                messages: { orderBy: { createdAt: 'asc' } },
                notes: { orderBy: { createdAt: 'asc' } },
                discussions: {
                    include: {
                        messages: { orderBy: { createdAt: 'asc' } },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        return NextResponse.json(ticket);
    } catch (error) {
        console.error('[GET /api/tickets/[id]] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
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
    try {
        const { id } = await params;

        // Check ticket exists
        const existing = await prisma.ticket.findFirst({
            where: {
                OR: [{ id }, { displayId: id }],
            },
        });

        if (!existing) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const body = await request.json();
        const allowedFields = ['status', 'priority', 'assigneeId', 'type'];
        const updates: Record<string, string | null> = {};

        for (const field of allowedFields) {
            if (field in body) {
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

        const updatedTicket = await prisma.ticket.update({
            where: { id: existing.id },
            data: updates,
            include: {
                account: true,
                user: true,
                assignee: true,
                messages: { orderBy: { createdAt: 'asc' } },
                notes: { orderBy: { createdAt: 'asc' } },
            },
        });

        return NextResponse.json(updatedTicket);
    } catch (error) {
        console.error('[PATCH /api/tickets/[id]] Error:', error);
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
