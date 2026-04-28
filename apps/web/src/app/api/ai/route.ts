import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
