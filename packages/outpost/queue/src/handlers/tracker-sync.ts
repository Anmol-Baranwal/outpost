/**
 * TRACKER_SYNC job handler.
 *
 * Consumes TRACKER_SYNC jobs from the queue, looks up the target
 * plugin from the SyncEngine registry, calls the appropriate push
 * method based on the action, and records a SyncEvent.
 */

import { prisma } from '@copilotkit/outpost/db';
import type { SyncEngine } from '@copilotkit/outpost/shared';
import type { TicketStatus, TicketPriority } from '@copilotkit/outpost/shared';
import type {
    ExternalTracker,
    InternalTracker,
    TicketExternalLinkRef,
    TeamMemberRef,
} from '@copilotkit/outpost/shared';
import type { TrackerSyncPayload, JobResult, JobHandlerContext } from '../types.js';

/**
 * Create a handler function bound to a SyncEngine instance.
 *
 * This factory pattern lets the worker register the handler with
 * the engine reference it needs, without global state.
 */
export function createTrackerSyncHandler(engine: SyncEngine) {
    return async function handleTrackerSync(
        payload: TrackerSyncPayload,
        context: JobHandlerContext,
    ): Promise<JobResult> {
        const { ticketId, targetPlugin, action, changeData } = payload;

        await context.reportProgress(10);

        // Look up the plugin
        const plugin = engine.getPlugin(targetPlugin);
        if (!plugin) {
            return {
                success: false,
                error: `Plugin "${targetPlugin}" is not registered`,
            };
        }

        await context.reportProgress(20);

        // Find the external link for this ticket + plugin
        const link = await prisma.ticketExternalLink.findUnique({
            where: {
                ticketId_plugin: {
                    ticketId,
                    plugin: targetPlugin,
                },
            },
        });

        if (!link) {
            return {
                success: false,
                error: `No external link found for ticket ${ticketId} on plugin "${targetPlugin}"`,
            };
        }

        const linkRef: TicketExternalLinkRef = {
            id: link.id,
            ticketId: link.ticketId,
            plugin: link.plugin,
            externalId: link.externalId,
            externalUrl: link.externalUrl,
            metadata: link.metadata as Record<string, unknown> | null,
        };

        await context.reportProgress(40);

        // Echo detection: compute hash and check before pushing
        const payloadHash = engine.computeHash(ticketId, targetPlugin, action, changeData);
        const isEcho = await engine.isEchoEvent(
            ticketId,
            'outpost',  // We are pushing FROM outpost TO target
            targetPlugin,
            payloadHash,
        );

        if (isEcho) {
            return {
                success: true,
                data: { skipped: true, reason: 'echo detected' },
            };
        }

        await context.reportProgress(50);

        try {
            await executePush(plugin, engine, linkRef, action, changeData);

            await context.reportProgress(80);

            // Record success
            await engine.recordSyncEvent(
                'outpost',
                targetPlugin,
                'ticket',
                ticketId,
                action,
                payloadHash,
                'success',
            );

            await context.reportProgress(100);

            console.log(
                `[TrackerSync] Pushed ${action} for ticket ${ticketId} to ${targetPlugin}`,
            );

            return {
                success: true,
                data: { ticketId, targetPlugin, action },
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // Record failure
            await engine.recordSyncEvent(
                'outpost',
                targetPlugin,
                'ticket',
                ticketId,
                action,
                payloadHash,
                'failure',
                message,
            );

            console.error(
                `[TrackerSync] Failed to push ${action} for ticket ${ticketId} to ${targetPlugin}: ${message}`,
            );

            return {
                success: false,
                error: message,
            };
        }
    };
}

/**
 * Dispatch the appropriate push method on the plugin based on the action.
 */
async function executePush(
    plugin: ExternalTracker | InternalTracker,
    engine: SyncEngine,
    link: TicketExternalLinkRef,
    action: string,
    changeData: Record<string, unknown>,
): Promise<void> {
    switch (action) {
        case 'status_change': {
            const status = changeData.status as TicketStatus;
            await plugin.pushStatusChange(link, status);
            break;
        }
        case 'comment': {
            const comment = changeData.comment as string;
            await plugin.pushComment(link, comment);
            break;
        }
        case 'label_change': {
            const labels = changeData.labels as string[];
            await plugin.pushLabels(link, labels);
            break;
        }
        case 'assignee_change': {
            if (engine.isInternalTracker(plugin.name)) {
                const internalPlugin = plugin as InternalTracker;
                const member = changeData.member as TeamMemberRef | undefined;
                if (member) {
                    await internalPlugin.pushAssignee(link, member);
                }
            }
            break;
        }
        case 'priority_change': {
            if (engine.isInternalTracker(plugin.name)) {
                const internalPlugin = plugin as InternalTracker;
                const priority = changeData.priority as TicketPriority;
                await internalPlugin.pushPriority(link, priority);
            }
            break;
        }
        default:
            throw new Error(`Unknown sync action: ${action}`);
    }
}
