import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';

/**
 * Validate that a URL is a valid Loom URL.
 */
function isValidLoomUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'www.loom.com' || parsed.hostname === 'loom.com';
    } catch {
        return false;
    }
}

/**
 * POST /api/docs/import-loom
 *
 * Accepts a Loom URL and generates a knowledge base article from the video transcript.
 * Currently stubbed — creates a placeholder article after validation.
 * In production this would fetch the Loom transcript via their API and pass it to AI.
 */
export async function POST(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

    try {
        const body = await request.json();

        if (!body.url) {
            return NextResponse.json(
                { error: 'url is required' },
                { status: 400 },
            );
        }

        if (!isValidLoomUrl(body.url)) {
            return NextResponse.json(
                { error: 'Invalid Loom URL. Must be a valid loom.com URL.' },
                { status: 400 },
            );
        }

        // Find or default to a category
        let categoryId = body.categoryId;
        if (!categoryId) {
            // Try to find a "guides" category, or use the first available
            const guidesCategory = await prisma.docCategory.findFirst({
                where: { name: { contains: 'guide', mode: 'insensitive' } },
            });
            if (guidesCategory) {
                categoryId = guidesCategory.id;
            } else {
                const anyCategory = await prisma.docCategory.findFirst();
                if (!anyCategory) {
                    return NextResponse.json(
                        { error: 'No categories exist. Create a category first.' },
                        { status: 400 },
                    );
                }
                categoryId = anyCategory.id;
            }
        }

        const videoSlug = body.url.split('/').pop() || 'video';

        // Stub content — in production, AI would generate this from the Loom transcript
        const content = `# Generated from Loom Video\n\n> This article was auto-generated from a Loom recording.\n> Source: ${body.url}\n\n## Summary\n\nThis is a placeholder for AI-generated content from the Loom video transcript.\n\n## Key Points\n\n- Point 1 from the video\n- Point 2 from the video\n- Point 3 from the video\n\n## Next Steps\n\nReview and edit this draft before publishing.`;

        const article = await prisma.docArticle.create({
            data: {
                title: `Article from Loom: ${videoSlug}`,
                content,
                status: 'DRAFT',
                sourceUrl: body.url,
                categoryId,
            },
            include: { category: true },
        });

        return NextResponse.json(article, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
