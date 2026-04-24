import { NextResponse } from 'next/server';
import { PathfinderClient } from '@copilotkit/outpost/ai';

/**
 * GET /api/dashboard/faq
 *
 * Returns top FAQ entries from Pathfinder knowledge base.
 * Falls back to empty array if Pathfinder is not configured or unavailable.
 */
export async function GET() {
    const pathfinderUrl = process.env.PATHFINDER_MCP_URL;

    if (!pathfinderUrl) {
        return NextResponse.json({
            entries: [],
            message: 'Pathfinder not configured. Set PATHFINDER_MCP_URL to enable FAQ retrieval.',
        });
    }

    const client = new PathfinderClient(pathfinderUrl);

    try {
        const results = await client.queryKnowledgeBase('frequently asked questions');

        const entries = results.map((result: { title: string; content: string; score: number }, index: number) => ({
            id: `faq-${index + 1}`,
            question: result.title,
            answer: result.content,
            sourceCount: Math.round(result.score * 100),
        }));

        client.disconnect();

        return NextResponse.json({ entries });
    } catch (error) {
        client.disconnect();
        console.error('[GET /api/dashboard/faq] Error:', error);
        return NextResponse.json({
            entries: [],
            message: 'Failed to fetch FAQ from Pathfinder.',
        });
    }
}
