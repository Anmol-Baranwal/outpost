import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { requireAdmin } from '@/lib/require-admin';

/**
 * POST /api/sync/force
 *
 * Trigger a force sync for a specific system plugin. Enqueues a
 * TRACKER_SYNC job per changed field (status, priority) for every ticket
 * currently linked to that plugin, or just one ticket when `ticketId`
 * is given. Ticket has no tags/labels field, so label_change is not
 * part of a resync.
 *
 * Body: { plugin: string, ticketId?: string }
 */
export async function POST(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

    try {
        const body = await request.json();
        const plugin = body.plugin;
        const ticketId = typeof body.ticketId === 'string' ? body.ticketId : undefined;

        if (!plugin || typeof plugin !== 'string') {
            return NextResponse.json(
                { error: 'plugin is required' },
                { status: 400 },
            );
        }

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

        const links = await prisma.ticketExternalLink.findMany({
            where: ticketId ? { plugin, ticketId } : { plugin },
            include: { ticket: true },
        });

        let jobs = 0;
        for (const link of links) {
            await createJob(JobType.TRACKER_SYNC, {
                ticketId: link.ticket.id,
                targetPlugin: plugin,
                action: 'status_change',
                changeData: { status: link.ticket.status },
            });
            jobs += 1;

            await createJob(JobType.TRACKER_SYNC, {
                ticketId: link.ticket.id,
                targetPlugin: plugin,
                action: 'priority_change',
                changeData: { priority: link.ticket.priority },
            });
            jobs += 1;
        }

        return NextResponse.json({ queued: links.length, jobs });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
