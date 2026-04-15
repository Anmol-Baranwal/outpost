import { NextRequest, NextResponse } from 'next/server';
import { findMockAccountFull, MOCK_ACCOUNTS_FULL } from '@/lib/mock-accounts';

/**
 * GET /api/accounts/:id
 *
 * Get a single account with ticket counts.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const account = findMockAccountFull(id);

    if (!account) {
        return NextResponse.json(
            { error: 'Account not found' },
            { status: 404 },
        );
    }

    return NextResponse.json(account);
}

/**
 * PATCH /api/accounts/:id
 *
 * Update account fields (owner, sentiment, engagement, etc).
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const account = MOCK_ACCOUNTS_FULL.find(a => a.id === id);

    if (!account) {
        return NextResponse.json(
            { error: 'Account not found' },
            { status: 404 },
        );
    }

    try {
        const body = await request.json();
        const allowedFields = ['owner', 'sentiment', 'engagement', 'acv', 'closeDate', 'name', 'domain'];
        const updates: Record<string, unknown> = {};

        for (const field of allowedFields) {
            if (field in body) {
                updates[field] = body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json(
                { error: 'No valid fields to update' },
                { status: 400 },
            );
        }

        // In production, this would use prisma.account.update()
        const updated = {
            ...account,
            ...updates,
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(updated);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
