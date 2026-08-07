import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { supportsOutboundSync } from '@copilotkit/outpost/shared';

/**
 * GET /api/sync/status
 *
 * Returns per-plugin sync health metrics derived from SyncEvent data.
 *
 * Each system carries `canForceSync`, so the dashboard can hide the force-sync
 * control for plugins the worker has no outbound adapter for. Resolved here
 * rather than in the client because the capability list lives in the shared
 * sync package alongside the registration it mirrors, and duplicating it into
 * a client component is how it would drift.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get distinct plugin pairs
    const plugins = await prisma.syncEvent.findMany({
        select: { sourcePlugin: true, targetPlugin: true },
        distinct: ['sourcePlugin', 'targetPlugin'],
    });

    // Collect unique plugins
    const pluginSet = new Set<string>();
    for (const p of plugins) {
        pluginSet.add(p.sourcePlugin);
        pluginSet.add(p.targetPlugin);
    }

    // Remove 'outpost' from the set — we report external systems
    pluginSet.delete('outpost');

    const systems = await Promise.all(
        Array.from(pluginSet).map(async (plugin) => {
            // Last successful sync
            const lastSuccess = await prisma.syncEvent.findFirst({
                where: {
                    OR: [
                        { sourcePlugin: plugin, status: 'success' },
                        { targetPlugin: plugin, status: 'success' },
                    ],
                },
                orderBy: { createdAt: 'desc' },
            });

            // Pending count
            const pendingCount = await prisma.syncEvent.count({
                where: {
                    OR: [
                        { sourcePlugin: plugin, status: 'pending' },
                        { targetPlugin: plugin, status: 'pending' },
                    ],
                },
            });

            // Failed count
            const failedCount = await prisma.syncEvent.count({
                where: {
                    OR: [
                        { sourcePlugin: plugin, status: 'failed' },
                        { targetPlugin: plugin, status: 'failed' },
                    ],
                },
            });

            return {
                plugin,
                lastSuccessfulSync: lastSuccess?.createdAt.toISOString() ?? null,
                pendingCount,
                failedCount,
                canForceSync: supportsOutboundSync(plugin),
            };
        }),
    );

    return NextResponse.json({ systems });
}
