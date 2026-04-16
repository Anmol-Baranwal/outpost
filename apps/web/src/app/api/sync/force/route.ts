import { NextRequest, NextResponse } from 'next/server';
import { MOCK_SYSTEM_STATUS } from '@/lib/mock-sync';

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

        const system = MOCK_SYSTEM_STATUS.find((s) => s.plugin === plugin);
        if (!system) {
            return NextResponse.json(
                { error: `Unknown plugin: ${plugin}` },
                { status: 404 },
            );
        }

        // In a real implementation this would enqueue a sync job.
        // For mock purposes, update the last sync timestamp.
        system.lastSuccessfulSync = new Date().toISOString();
        system.pendingCount = 0;

        return NextResponse.json({
            success: true,
            plugin,
            message: `Force sync triggered for ${plugin}`,
        });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
