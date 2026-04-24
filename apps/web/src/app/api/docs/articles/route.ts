import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/docs/articles
 *
 * List articles with optional filters.
 * Query params: category, status, search
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const categoryId = searchParams.get('category');
    const status = searchParams.get('status')?.toUpperCase() as 'DRAFT' | 'PUBLISHED' | null;
    const search = searchParams.get('search');

    const where: Prisma.DocArticleWhereInput = {};

    if (categoryId) {
        where.categoryId = categoryId;
    }

    if (status && (status === 'DRAFT' || status === 'PUBLISHED')) {
        where.status = status;
    }

    if (search) {
        where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { content: { contains: search, mode: 'insensitive' } },
        ];
    }

    const articles = await prisma.docArticle.findMany({
        where,
        include: { category: true },
        orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ articles, total: articles.length });
}

/**
 * POST /api/docs/articles
 *
 * Create a new article. Required: title, categoryId, content.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.title || !body.categoryId || !body.content) {
            return NextResponse.json(
                { error: 'title, categoryId, and content are required' },
                { status: 400 },
            );
        }

        // Verify the category exists
        const category = await prisma.docCategory.findUnique({
            where: { id: body.categoryId },
        });

        if (!category) {
            return NextResponse.json(
                { error: 'Category not found' },
                { status: 404 },
            );
        }

        const newArticle = await prisma.docArticle.create({
            data: {
                title: body.title,
                content: body.content,
                status: 'DRAFT',
                sourceUrl: body.sourceUrl || null,
                categoryId: body.categoryId,
            },
            include: { category: true },
        });

        return NextResponse.json(newArticle, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
