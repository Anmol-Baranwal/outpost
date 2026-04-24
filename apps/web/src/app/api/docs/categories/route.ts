import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

/**
 * GET /api/docs/categories
 *
 * List all documentation categories with article counts.
 */
export async function GET() {
    const categories = await prisma.docCategory.findMany({
        include: {
            _count: {
                select: { articles: true },
            },
        },
        orderBy: { name: 'asc' },
    });

    const result = categories.map((cat: typeof categories[number]) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        articleCount: cat._count.articles,
        createdAt: cat.createdAt,
    }));

    return NextResponse.json({ categories: result });
}
