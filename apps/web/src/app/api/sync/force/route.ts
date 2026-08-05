import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { requireAdmin } from '@/lib/require-admin';

/**
 * POST /api/sync/force
 *
 * Trigger a force sync for a specific system plugin. Unconditionally
 * enqueues status_change and priority_change TRACKER_SYNC jobs (no
 * change detection) for every ticket currently linked to that plugin,
 * or just one ticket when `ticketId` is given. Ticket has no
 * tags/labels field, so label_change is not part of a resync.
 *
 * Body: { plugin: string, ticketId?: string }
 */
export async function POST(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

    let body: { plugin?: unknown; ticketId?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const plugin = body.plugin;
    const ticketId = typeof body.ticketId === 'string' ? body.ticketId : undefined;

    if (!plugin || typeof plugin !== 'string') {
        return NextResponse.json({ error: 'plugin is required' }, { status: 400 });
    }

    const [knownPlugin, hasLinks] = await Promise.all([
        prisma.syncEvent.findFirst({
            where: {
                OR: [{ sourcePlugin: plugin }, { targetPlugin: plugin }],
            },
        }),
        prisma.ticketExternalLink.findFirst({ where: { plugin } }),
    ]);

    if (!knownPlugin && !hasLinks) {
        return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
    }

    const links = await prisma.ticketExternalLink.findMany({
        where: ticketId ? { plugin, ticketId } : { plugin },
        include: { ticket: true },
    });

    // Enqueued in parallel rather than 2xN sequential round-trips: a plugin with
    // many linked tickets made this a long chain that could brush the route
    // timeout on a large workspace.
    //
    // Promise.all, NOT allSettled: a failed enqueue must still propagate so the
    // route 500s. That behaviour is deliberate and pinned by
    // sync-api.test.ts ("does not mislabel a mid-loop DB/queue error") — a DB or
    // queue failure disguised as a 4xx was the bug this endpoint's error handling
    // was narrowed to fix.
    //
    // This operation is therefore NOT atomic, by conscious choice: if one insert
    // fails, jobs already enqueued stay enqueued and a retry re-enqueues from
    // scratch, producing duplicate TRACKER_SYNC jobs. Acceptable here because the
    // handler is idempotent in effect (it pushes current ticket state, so a
    // duplicate write is a no-op) and this is a manual admin action, not an
    // automated path.
    const jobs = (
        await Promise.all(
            links.flatMap((link: (typeof links)[number]) => [
                createJob(JobType.TRACKER_SYNC, {
                    ticketId: link.ticket.id,
                    targetPlugin: plugin,
                    action: 'status_change',
                    changeData: { status: link.ticket.status },
                }),
                createJob(JobType.TRACKER_SYNC, {
                    ticketId: link.ticket.id,
                    targetPlugin: plugin,
                    action: 'priority_change',
                    changeData: { priority: link.ticket.priority },
                }),
            ]),
        )
    ).length;

    return NextResponse.json({ queued: links.length, jobs });
}
