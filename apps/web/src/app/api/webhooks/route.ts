import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    const body = await request.json();
    const source = request.headers.get('x-webhook-source');

    // TODO: Route webhook to appropriate handler
    // - Discord events
    // - GitHub events
    // - Custom webhook sources
    console.log(`[Webhook] Received from ${source ?? 'unknown'}:`, JSON.stringify(body).slice(0, 200));

    return NextResponse.json({ received: true });
}
