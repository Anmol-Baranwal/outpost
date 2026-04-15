import { NextRequest, NextResponse } from 'next/server';
import { getArticleById } from '@/lib/mock-docs';

/**
 * PATCH /api/docs/articles/[id]
 *
 * Update an article's content and/or publish status.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const article = getArticleById(id);

    if (!article) {
        return NextResponse.json(
            { error: 'Article not found' },
            { status: 404 },
        );
    }

    try {
        const body = await request.json();

        const updated = {
            ...article,
            ...(body.title !== undefined && { title: body.title }),
            ...(body.content !== undefined && { content: body.content }),
            ...(body.status !== undefined && { status: body.status }),
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
