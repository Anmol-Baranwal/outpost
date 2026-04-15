import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    const body = await request.json();

    // TODO: Wire up the AI pipeline
    // 1. Search Pathfinder for relevant docs
    // 2. Generate response with Claude
    // 3. Return structured response with confidence
    return NextResponse.json(
        {
            message: 'AI pipeline not yet implemented',
            query: body.query ?? '',
        },
        { status: 501 },
    );
}
