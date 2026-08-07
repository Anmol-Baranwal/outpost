import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import {
    loadStatusMap,
    singleReadConfigDb,
    supportsOutboundSync,
    TicketStatus,
} from '@copilotkit/outpost/shared';
import { requireAdmin } from '@/lib/require-admin';

/**
 * POST /api/sync/force
 *
 * Trigger a force sync for a specific system plugin. Enqueues status_change
 * and priority_change TRACKER_SYNC jobs (no change detection) for every ticket
 * currently linked to that plugin, or just one ticket when `ticketId` is given.
 * Ticket has no tags/labels field, so label_change is not part of a resync.
 *
 * Two things are deliberately NOT enqueued:
 *
 *  - plugins with no registered outbound adapter (see supportsOutboundSync)
 *  - status changes whose value has no reverse mapping for this plugin
 *
 * The first would produce jobs that fail and retry to the DLQ. The second would
 * produce jobs that no-op in the adapter — enqueuing them would just hide the
 * missing mapping, so they are skipped and named in the response instead.
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

    // The plugin exists here (it has sync events or links) but that does not
    // mean the worker can sync TO it. github-app writes TicketExternalLink rows
    // and SyncEvent rows, so 'github' clears the probes above — while
    // buildSyncEngine registers Linear only. Without this gate a "Force Github"
    // click enqueues 2N jobs that each fail "Plugin is not registered", exhaust
    // their retries, and land in the DLQ. Checked after the 404 probes so the
    // two cases stay distinguishable: 404 = no such plugin, 400 = real plugin,
    // no outbound adapter.
    if (!supportsOutboundSync(plugin)) {
        return NextResponse.json(
            {
                error: `Plugin "${plugin}" has no outbound sync adapter registered, so there is nothing to force a sync to.`,
            },
            { status: 400 },
        );
    }

    const links = await prisma.ticketExternalLink.findMany({
        where: ticketId ? { plugin, ticketId } : { plugin },
        // Only the three columns the payloads use, not whole ticket rows.
        select: { ticket: { select: { id: true, status: true, priority: true } } },
    });

    // Nothing linked: return before loading any mapping config, so a no-op
    // resync costs zero extra reads.
    if (links.length === 0) {
        return NextResponse.json({ queued: 0, jobs: 0, skipped: 0, unmappable: [] });
    }

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

    // Only enqueue status changes that survive the round trip.
    //
    // StatusMap.fromOutpost falls back to the FIRST entry of its config for any
    // Outpost status with no reverse mapping. TicketStatus has six values and
    // createLinearStatusMap covers four, so WAITING_ON_CUSTOMER and
    // WAITING_ON_TEAM would both resolve to 'Triage'.
    //
    // LinearAdapter.pushStatusChange refuses to guess for exactly this reason, so
    // an unmappable status is already safe on the push side. This filter is not
    // the safety net — it is the operator-facing half: skipping here means the
    // response can name which values have no mapping, instead of enqueuing jobs
    // that quietly no-op. Uses the same loader the worker uses, so it reflects
    // the mapping actually in effect rather than the hardcoded defaults.
    //
    // Read through the shared read-once facade: one row, however many loaders
    // end up asking for it (buildSyncEngine does the same for its three).
    const configDb = singleReadConfigDb(prisma);

    const statusMap = await loadStatusMap(plugin, configDb);

    const payloads: {
        ticketId: string;
        targetPlugin: string;
        action: 'status_change' | 'priority_change';
        changeData: Record<string, string>;
    }[] = [];
    const skipped: string[] = [];

    for (const link of links) {
        const { id, status, priority } = link.ticket;

        if (statusMap.hasOutpost(status as TicketStatus)) {
            payloads.push({
                ticketId: id,
                targetPlugin: plugin,
                action: 'status_change',
                changeData: { status },
            });
        } else {
            skipped.push(`status:${status}`);
        }

        // Priority is NOT filtered. Linear's outbound priority goes through
        // LinearAdapter.outpostPriorityToLinearNumber — an exhaustive switch over
        // all four TicketPriority values — not through the PriorityMap, which is
        // inbound-only until #96 wires the persisted priority config into the
        // worker. Filtering on a map the push path never consults would skip
        // priority changes the adapter handles perfectly well.
        payloads.push({
            ticketId: id,
            targetPlugin: plugin,
            action: 'priority_change',
            changeData: { priority },
        });
    }

    // Distinct rather than per-ticket: the operator needs to know WHICH values
    // have no mapping (so they can add one), not which of 10k tickets held them.
    const unmappable = Array.from(new Set(skipped)).sort();

    if (skipped.length > 0) {
        console.warn(
            `[sync/force] Skipped ${skipped.length} change(s) for plugin "${plugin}" with no ` +
                `reverse mapping: ${unmappable.join(', ')}. Add mappings for these on ` +
                `/sync/mappings, or they will stay out of sync.`,
        );
    }

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

    return NextResponse.json({ queued: links.length, jobs, skipped: skipped.length, unmappable });
}
