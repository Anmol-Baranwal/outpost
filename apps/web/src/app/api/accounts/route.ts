import { NextRequest, NextResponse } from 'next/server';
import { filterMockAccounts } from '@/lib/mock-accounts';

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
    const sortDir = (searchParams.get('sortDir') as 'asc' | 'desc') || undefined;

    const accounts = filterMockAccounts({
        search,
        owner,
        sentiment: sentiment.length ? sentiment : undefined,
        engagement: engagement.length ? engagement : undefined,
        sort,
        sortDir,
    });

    return NextResponse.json({
        accounts,
        total: accounts.length,
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

        // In production, this would use prisma.account.create()
        const newAccount = {
            id: `acc-${Date.now()}`,
            name: body.name,
            domain: body.domain || null,
            owner: body.owner || null,
            sentiment: body.sentiment || 'NEUTRAL',
            engagement: body.engagement || 'MEDIUM',
            acv: body.acv || null,
            closeDate: body.closeDate || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            openTickets: 0,
            inProgressTickets: 0,
            closedTickets: 0,
        };

        return NextResponse.json(newAccount, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
