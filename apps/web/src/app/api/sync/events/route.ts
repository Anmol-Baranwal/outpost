import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/sync/events
 *
 * Paginated sync event audit log with optional filters.
 * Query params: sourcePlugin, targetPlugin, status, startDate, endDate, page, limit
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;

    const sourcePlugin = searchParams.get('sourcePlugin') || undefined;
    const targetPlugin = searchParams.get('targetPlugin') || undefined;
    const status = searchParams.get('status') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50));

    const where: Prisma.SyncEventWhereInput = {};

    if (sourcePlugin) where.sourcePlugin = sourcePlugin;
    if (targetPlugin) where.targetPlugin = targetPlugin;
    if (status) where.status = status;

    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [events, total] = await Promise.all([
        prisma.syncEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.syncEvent.count({ where }),
    ]);

    return NextResponse.json({
        events,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    });
}
