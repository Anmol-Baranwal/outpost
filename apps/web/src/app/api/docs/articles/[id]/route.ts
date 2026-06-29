import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/docs/articles/[id]
 *
 * Retrieve a single article by ID.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error } = await requireSession();
    if (error) return error;

    const { id } = await params;

    const article = await prisma.docArticle.findUnique({
        where: { id },
        include: { category: true },
    });

    if (!article) {
        return NextResponse.json(
            { error: 'Article not found' },
            { status: 404 },
        );
    }

    return NextResponse.json(article);
}

/**
 * PATCH /api/docs/articles/[id]
 *
 * Update an article's content and/or publish status.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const article = await prisma.docArticle.findUnique({ where: { id } });

    if (!article) {
        return NextResponse.json(
            { error: 'Article not found' },
            { status: 404 },
        );
    }

    try {
        const body = await request.json();

        const data: Record<string, unknown> = {};
        if (body.title !== undefined) data.title = body.title;
        if (body.content !== undefined) data.content = body.content;
        if (body.status !== undefined) data.status = body.status;

        const updated = await prisma.docArticle.update({
            where: { id },
            data,
            include: { category: true },
        });

        return NextResponse.json(updated);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
