import { NextRequest, NextResponse } from 'next/server';
import { filterMockTickets, MOCK_TICKETS } from '@/lib/mock-tickets';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, generateTicketId } from '@copilotkit/outpost-shared';
import { TicketStatus, TicketPriority, TicketType, TicketSource } from '@copilotkit/outpost-shared';

/**
 * GET /api/tickets
 *
 * List tickets with optional filters and pagination.
 * Query params: status, source, priority, type, accountId, assigneeId, search, page, pageSize
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;

    const status = searchParams.getAll('status');
    const source = searchParams.getAll('source');
    const priority = searchParams.getAll('priority');
    const type = searchParams.getAll('type');
    const accountId = searchParams.get('accountId') || undefined;
    const assigneeId = searchParams.get('assigneeId') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10)),
    );

    const filtered = filterMockTickets({
        status: status.length ? status : undefined,
        source: source.length ? source : undefined,
        priority: priority.length ? priority : undefined,
        type: type.length ? type : undefined,
        accountId,
        assigneeId,
        search,
    });

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const tickets = filtered.slice(startIndex, startIndex + pageSize);

    return NextResponse.json({
        tickets,
        total,
        page,
        pageSize,
    });
}

/**
 * POST /api/tickets
 *
 * Create a new ticket. Required fields: title, description.
 * Optional: priority, type, source, accountId, assigneeId.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.title || !body.description) {
            return NextResponse.json(
                { error: 'title and description are required' },
                { status: 400 },
            );
        }

        const newTicket = {
            id: `tkt-${Date.now()}`,
            displayId: generateTicketId(),
            title: body.title,
            description: body.description,
            status: TicketStatus.OPEN,
            priority: (body.priority as TicketPriority) || TicketPriority.MEDIUM,
            type: (body.type as TicketType) || TicketType.QUESTION,
            source: (body.source as TicketSource) || TicketSource.MANUAL,
            sourceUrl: body.sourceUrl || null,
            additionalInfo: body.additionalInfo || null,
            suggestedResponse: null,
            assigneeId: body.assigneeId || null,
            assignee: null,
            accountId: body.accountId || null,
            account: null,
            userId: body.userId || null,
            user: null,
            messages: [],
            notes: [],
            slaBreachedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            unread: false,
        };

        // In production, this would use prisma.ticket.create()
        // For now, we return the created ticket without persisting
        return NextResponse.json(newTicket, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
