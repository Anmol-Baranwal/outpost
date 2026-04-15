import { NextRequest, NextResponse } from 'next/server';
import { isValidLoomUrl } from '@/lib/mock-docs';

/**
 * POST /api/docs/import-loom
 *
 * Accepts a Loom URL and generates a knowledge base article from the video transcript.
 * Currently stubbed -- returns a mock article after validation.
 */
export async function POST(request: NextRequest) {
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

        // Stub: In production, this would:
        // 1. Fetch the Loom video transcript via Loom API
        // 2. Pass transcript to AI for article generation
        // 3. Save the generated article as a draft
        const generatedArticle = {
            id: `art-loom-${Date.now()}`,
            categorySlug: body.categorySlug || 'guides',
            title: `Article from Loom: ${body.url.split('/').pop() || 'video'}`,
            status: 'draft' as const,
            content: `# Generated from Loom Video\n\n> This article was auto-generated from a Loom recording.\n> Source: ${body.url}\n\n## Summary\n\nThis is a placeholder for AI-generated content from the Loom video transcript.\n\n## Key Points\n\n- Point 1 from the video\n- Point 2 from the video\n- Point 3 from the video\n\n## Next Steps\n\nReview and edit this draft before publishing.`,
            source: 'loom' as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(generatedArticle, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
