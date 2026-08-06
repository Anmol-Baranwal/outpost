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
        // Only the three columns the payloads use, not whole ticket rows.
        select: { ticket: { select: { id: true, status: true, priority: true } } },
    });

    // Enqueued in BOUNDED batches. Sequential 2xN round-trips could brush the
    // route timeout on a large workspace; an unbounded Promise.all over 2N inserts
    // just trades that for Prisma pool-acquisition timeouts, which is the same
    // outage with a less obvious error. Chunks keep both bounded.
    //
    // Promise.all within each chunk, NOT allSettled: a failed enqueue must still
    // propagate so the route 500s. That is deliberate and pinned by
    // sync-api.test.ts ("does not mislabel a mid-loop DB/queue error") — a DB or
    // queue failure disguised as a 4xx was the bug this endpoint's error handling
    // was narrowed to fix.
    //
    // This operation is therefore NOT atomic, by conscious choice: if one insert
    // fails, jobs already enqueued stay enqueued and a retry re-enqueues from
    // scratch, producing duplicate TRACKER_SYNC jobs. Acceptable here because the
    // handler pushes current ticket state, so a duplicate write is a no-op in
    // effect, and this is a manual admin action rather than an automated path.
    const ENQUEUE_CHUNK_SIZE = 50;

    const payloads = links.flatMap((link: (typeof links)[number]) => [
        {
            ticketId: link.ticket.id,
            targetPlugin: plugin,
            action: 'status_change',
            changeData: { status: link.ticket.status },
        },
        {
            ticketId: link.ticket.id,
            targetPlugin: plugin,
            action: 'priority_change',
            changeData: { priority: link.ticket.priority },
        },
    ]);

    for (let i = 0; i < payloads.length; i += ENQUEUE_CHUNK_SIZE) {
        await Promise.all(
            payloads
                .slice(i, i + ENQUEUE_CHUNK_SIZE)
                .map((payload) => createJob(JobType.TRACKER_SYNC, payload)),
        );
    }

    // Every payload either enqueued or the loop above threw, so this is exact
    // rather than a count accumulated as we went.
    const jobs = payloads.length;

    return NextResponse.json({ queued: links.length, jobs });
}
