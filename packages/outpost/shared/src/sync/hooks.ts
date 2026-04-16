/**
 * Lifecycle hooks for ticket operations.
 *
 * These hooks are called by platform integrations (Discord bot, Slack bot,
 * GitHub App, etc.) after they create or update tickets. Each hook invokes
 * the sync triggers to push changes to the configured internal tracker.
 *
 * The `source` parameter identifies which system originated the change,
 * enabling loop prevention (the engine will skip pushing back to the source).
 */

import type { SyncEngine } from './engine.js';
import type { SyncTicket, SyncMessage, TicketChanges } from './triggers.js';
import { onTicketCreated, onTicketUpdated, onMessageCreated } from './triggers.js';

// ─── Hook Interface ─────────────────────────────────────────────────────

export interface SyncHooks {
    afterTicketCreate(ticket: SyncTicket, source: string): Promise<void>;
    afterTicketUpdate(ticket: SyncTicket, changes: TicketChanges, source: string): Promise<void>;
    afterMessageCreate(ticket: SyncTicket, message: SyncMessage, source: string): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────

/**
 * Create a set of lifecycle hooks bound to a SyncEngine.
 *
 * Each hook wraps the corresponding sync trigger, catching and logging
 * errors so that a sync failure never breaks the primary integration flow.
 */
export function createSyncHooks(engine: SyncEngine): SyncHooks {
    return {
        async afterTicketCreate(ticket: SyncTicket, source: string): Promise<void> {
            try {
                await onTicketCreated(engine, ticket, source);
            } catch (err) {
                console.error(
                    `[SyncHooks] afterTicketCreate failed for ticket ${ticket.id}:`,
                    err instanceof Error ? err.message : err,
                );
            }
        },

        async afterTicketUpdate(ticket: SyncTicket, changes: TicketChanges, source: string): Promise<void> {
            try {
                await onTicketUpdated(engine, ticket, changes, source);
            } catch (err) {
                console.error(
                    `[SyncHooks] afterTicketUpdate failed for ticket ${ticket.id}:`,
                    err instanceof Error ? err.message : err,
                );
            }
        },

        async afterMessageCreate(ticket: SyncTicket, message: SyncMessage, source: string): Promise<void> {
            try {
                await onMessageCreated(engine, ticket, message, source);
            } catch (err) {
                console.error(
                    `[SyncHooks] afterMessageCreate failed for ticket ${ticket.id}:`,
                    err instanceof Error ? err.message : err,
                );
            }
        },
    };
}
