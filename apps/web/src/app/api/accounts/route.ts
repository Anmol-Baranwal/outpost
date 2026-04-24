import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/accounts
 *
 * List accounts with optional search, sort, and filter.
 * Query params: search, owner, sentiment, engagement, sort, sortDir
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;

    const search = searchParams.get('search') || undefined;
    const owner = searchParams.get('owner') || undefined;
    const sentiment = searchParams.getAll('sentiment');
    const engagement = searchParams.getAll('engagement');
    const sort = searchParams.get('sort') || undefined;
    const sortDir = (searchParams.get('sortDir') as 'asc' | 'desc') || 'asc';

    const where: Prisma.AccountWhereInput = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { domain: { contains: search, mode: 'insensitive' } },
            { owner: { contains: search, mode: 'insensitive' } },
        ];
    }

    if (owner) {
        where.owner = owner;
    }

    if (sentiment.length) {
        where.sentiment = { in: sentiment as Prisma.EnumAccountSentimentFilter['in'] };
    }

    if (engagement.length) {
        where.engagement = { in: engagement as Prisma.EnumAccountEngagementFilter['in'] };
    }

    // Map sort fields — ticket count fields require special handling
    const ticketCountFields = ['openTickets', 'inProgressTickets', 'closedTickets'];
    let orderBy: Prisma.AccountOrderByWithRelationInput | undefined;

    if (sort && !ticketCountFields.includes(sort)) {
        orderBy = { [sort]: sortDir };
    }

    const accounts = await prisma.account.findMany({
        where,
        orderBy,
        include: {
            _count: {
                select: { tickets: true },
            },
        },
    });

    // Fetch ticket counts broken down by status for each account
    const accountIds = accounts.map((a: { id: string }) => a.id);

    const ticketCounts = await prisma.ticket.groupBy({
        by: ['accountId', 'status'],
        where: { accountId: { in: accountIds } },
        _count: true,
    });

    // Build a map: accountId -> { openTickets, inProgressTickets, closedTickets }
    const countMap = new Map<string, { openTickets: number; inProgressTickets: number; closedTickets: number }>();
    for (const id of accountIds) {
        countMap.set(id, { openTickets: 0, inProgressTickets: 0, closedTickets: 0 });
    }

    for (const row of ticketCounts) {
        if (!row.accountId) continue;
        const entry = countMap.get(row.accountId);
        if (!entry) continue;

        switch (row.status) {
            case 'OPEN':
            case 'WAITING_ON_CUSTOMER':
            case 'WAITING_ON_TEAM':
                entry.openTickets += row._count;
                break;
            case 'IN_PROGRESS':
                entry.inProgressTickets += row._count;
                break;
            case 'RESOLVED':
            case 'CLOSED':
                entry.closedTickets += row._count;
                break;
        }
    }

    const result = accounts.map((account: typeof accounts[number]) => {
        const counts = countMap.get(account.id) ?? { openTickets: 0, inProgressTickets: 0, closedTickets: 0 };
        return {
            ...account,
            ...counts,
        };
    });

    // Sort by ticket count fields if requested (can't be done in Prisma)
    if (sort && ticketCountFields.includes(sort)) {
        const dir = sortDir === 'desc' ? -1 : 1;
        result.sort((a: typeof result[number], b: typeof result[number]) => {
            const aVal = (a as Record<string, unknown>)[sort] as number;
            const bVal = (b as Record<string, unknown>)[sort] as number;
            return (aVal - bVal) * dir;
        });
    }

    return NextResponse.json({
        accounts: result,
        total: result.length,
    });
}

/**
 * POST /api/accounts
 *
 * Create a new account. Required: name.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.name) {
            return NextResponse.json(
                { error: 'name is required' },
                { status: 400 },
            );
        }

        const newAccount = await prisma.account.create({
            data: {
                name: body.name,
                domain: body.domain || null,
                owner: body.owner || null,
                sentiment: body.sentiment || 'NEUTRAL',
                engagement: body.engagement || 'MEDIUM',
                acv: body.acv ?? null,
                closeDate: body.closeDate ? new Date(body.closeDate) : null,
            },
        });

        return NextResponse.json(
            {
                ...newAccount,
                openTickets: 0,
                inProgressTickets: 0,
                closedTickets: 0,
            },
            { status: 201 },
        );
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
