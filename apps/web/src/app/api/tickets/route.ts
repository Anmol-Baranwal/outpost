import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, generateTicketId } from '@copilotkit/outpost/shared';
import { TicketStatus, TicketPriority, TicketType, TicketSource, Prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/tickets
 *
 * List tickets with optional filters and pagination.
 * Query params: status, source, priority, type, accountId, assigneeId, search, page, pageSize
 */
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
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

        const where: Prisma.TicketWhereInput = {};

        if (status.length) {
            where.status = { in: status as TicketStatus[] };
        }
        if (source.length) {
            where.source = { in: source as TicketSource[] };
        }
        if (priority.length) {
            where.priority = { in: priority as TicketPriority[] };
        }
        if (type.length) {
            where.type = { in: type as TicketType[] };
        }
        if (accountId) {
            where.accountId = accountId;
        }
        if (assigneeId) {
            where.assigneeId = assigneeId;
        }
        if (search) {
            const q = search.toLowerCase();
            where.OR = [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { displayId: { contains: q, mode: 'insensitive' } },
                { account: { name: { contains: q, mode: 'insensitive' } } },
                { user: { name: { contains: q, mode: 'insensitive' } } },
            ];
        }

        const [tickets, total] = await Promise.all([
            prisma.ticket.findMany({
                where,
                include: {
                    account: true,
                    user: true,
                    assignee: true,
                    messages: { take: 1, orderBy: { createdAt: 'desc' } },
                },
                orderBy: { createdAt: 'desc' },
                take: pageSize,
                skip: (page - 1) * pageSize,
            }),
            prisma.ticket.count({ where }),
        ]);

        return NextResponse.json({
            tickets,
            total,
            page,
            pageSize,
        });
    } catch (error) {
        console.error('[GET /api/tickets] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}

/**
 * POST /api/tickets
 *
 * Create a new ticket. Required fields: title, description.
 * Optional: priority, type, source, accountId, assigneeId, userId, sourceUrl, additionalInfo.
 */
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        if (!body.title || !body.description) {
            return NextResponse.json(
                { error: 'title and description are required' },
                { status: 400 },
            );
        }

        const ticket = await prisma.ticket.create({
            data: {
                displayId: generateTicketId(),
                title: body.title,
                description: body.description,
                status: TicketStatus.OPEN,
                priority: (body.priority as TicketPriority) || TicketPriority.MEDIUM,
                type: (body.type as TicketType) || TicketType.QUESTION,
                source: (body.source as TicketSource) || TicketSource.MANUAL,
                sourceUrl: body.sourceUrl || null,
                additionalInfo: body.additionalInfo || undefined,
                assigneeId: body.assigneeId || null,
                accountId: body.accountId || null,
                userId: body.userId || null,
            },
            include: {
                account: true,
                user: true,
                assignee: true,
                messages: true,
                notes: true,
            },
        });

        return NextResponse.json(ticket, { status: 201 });
    } catch (error) {
        console.error('[POST /api/tickets] Error:', error);
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
