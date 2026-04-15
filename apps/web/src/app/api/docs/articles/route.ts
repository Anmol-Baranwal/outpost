import { NextRequest, NextResponse } from 'next/server';
import { MOCK_ARTICLES } from '@/lib/mock-docs';
import type { ArticleStatus } from '@/lib/mock-docs';

/**
 * GET /api/docs/articles
 *
 * List articles with optional filters.
 * Query params: category, status, search
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const category = searchParams.get('category');
    const status = searchParams.get('status') as ArticleStatus | null;
    const search = searchParams.get('search');

    let articles = [...MOCK_ARTICLES];

    if (category) {
        articles = articles.filter(a => a.categorySlug === category);
    }

    if (status) {
        articles = articles.filter(a => a.status === status);
    }

    if (search) {
        const lower = search.toLowerCase();
        articles = articles.filter(
            a => a.title.toLowerCase().includes(lower) || a.content.toLowerCase().includes(lower),
        );
    }

    return NextResponse.json({ articles, total: articles.length });
}

/**
 * POST /api/docs/articles
 *
 * Create a new article. Required: title, categorySlug, content.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.title || !body.categorySlug || !body.content) {
            return NextResponse.json(
                { error: 'title, categorySlug, and content are required' },
                { status: 400 },
            );
        }

        const newArticle = {
            id: `art-${Date.now()}`,
            categorySlug: body.categorySlug,
            title: body.title,
            status: 'draft' as const,
            content: body.content,
            source: body.source || 'manual',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(newArticle, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
