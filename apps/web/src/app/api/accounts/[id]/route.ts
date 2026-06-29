import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/accounts/:id
 *
 * Get a single account with ticket counts.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error } = await requireSession();
    if (error) return error;

    const { id } = await params;

    const account = await prisma.account.findUnique({
        where: { id },
        include: {
            users: true,
            tickets: {
                select: { id: true, status: true },
            },
        },
    });

    if (!account) {
        return NextResponse.json(
            { error: 'Account not found' },
            { status: 404 },
        );
    }

    const openTickets = account.tickets.filter(
        (t: { status: string }) => t.status === 'OPEN' || t.status === 'WAITING_ON_CUSTOMER' || t.status === 'WAITING_ON_TEAM',
    ).length;
    const inProgressTickets = account.tickets.filter(
        (t: { status: string }) => t.status === 'IN_PROGRESS',
    ).length;
    const closedTickets = account.tickets.filter(
        (t: { status: string }) => t.status === 'CLOSED' || t.status === 'RESOLVED',
    ).length;

    const { tickets, ...accountData } = account;

    return NextResponse.json({
        ...accountData,
        openTickets,
        inProgressTickets,
        closedTickets,
    });
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
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    const existing = await prisma.account.findUnique({ where: { id } });

    if (!existing) {
        return NextResponse.json(
            { error: 'Account not found' },
            { status: 404 },
        );
    }

    try {
        const body = await request.json();
        const allowedFields = ['owner', 'sentiment', 'engagement', 'acv', 'closeDate', 'name', 'domain'];
        const data: Record<string, unknown> = {};

        for (const field of allowedFields) {
            if (field in body) {
                if (field === 'closeDate' && body[field]) {
                    data[field] = new Date(body[field]);
                } else {
                    data[field] = body[field];
                }
            }
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json(
                { error: 'No valid fields to update' },
                { status: 400 },
            );
        }

        const updated = await prisma.account.update({
            where: { id },
            data,
        });

        return NextResponse.json(updated);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
