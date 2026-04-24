import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

/**
 * POST /api/sync/force
 *
 * Trigger a force sync for a specific system plugin.
 * Body: { plugin: string }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const plugin = body.plugin;

        if (!plugin || typeof plugin !== 'string') {
            return NextResponse.json(
                { error: 'plugin is required' },
                { status: 400 },
            );
        }

        // Verify the plugin is known by checking if any sync events exist for it
        const knownPlugin = await prisma.syncEvent.findFirst({
            where: {
                OR: [
                    { sourcePlugin: plugin },
                    { targetPlugin: plugin },
                ],
            },
        });

        if (!knownPlugin) {
            return NextResponse.json(
                { error: `Unknown plugin: ${plugin}` },
                { status: 404 },
            );
        }

        // TODO: TRACKER_SYNC expects a real ticketId; bulk/full sync needs a
        // dedicated FULL_SYNC job type or iteration over all linked tickets.
        // For now, return 501 until the handler supports bulk sync.
        return NextResponse.json(
            { error: 'Bulk force sync not yet implemented' },
            { status: 501 },
        );
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
