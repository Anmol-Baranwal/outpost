/**
 * Sync triggers — fire TRACKER_SYNC jobs when tickets change in Outpost.
 *
 * Each trigger checks whether the change originated from the target system
 * (loop prevention) before enqueuing work. All actual push logic lives in
 * the TRACKER_SYNC job handler; triggers only decide *whether* to enqueue.
 */

import type { SyncEngine } from './engine.js';
import type { TicketChange } from './types.js';
import type { TicketStatus, TicketPriority, MessageType } from '../types.js';

// ─── Lightweight Ticket / Message shapes (no Prisma dependency) ─────────

export interface SyncTicket {
    id: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    /** External link ID in the internal tracker, if already synced */
    internalId?: string | null;
}

export interface SyncMessage {
    id: string;
    body: string;
    type: MessageType;
}

export interface TicketChanges {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigneeId?: string;
    labels?: string[];
}

// ─── Trigger Functions ──────────────────────────────────────────────────

/**
 * Trigger after a new ticket is created.
 *
 * If the ticket has no internalId (not yet synced to the internal tracker),
 * enqueue a TRACKER_SYNC job with action "new_issue".
 */
export async function onTicketCreated(
    engine: SyncEngine,
    ticket: SyncTicket,
    sourceSystem: string,
): Promise<void> {
    if (ticket.internalId) {
        return; // already synced
    }

    const change: TicketChange = {
        externalId: '',
        action: 'new_issue',
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
    };

    await engine.onTicketChange(ticket.id, change, sourceSystem);
}

/**
 * Trigger after a ticket is updated.
 *
 * Enqueues one TRACKER_SYNC job per changed field (status, priority,
 * assignee, labels).
 */
export async function onTicketUpdated(
    engine: SyncEngine,
    ticket: SyncTicket,
    changes: TicketChanges,
    sourceSystem: string,
): Promise<void> {
    if (changes.status) {
        await engine.onTicketChange(ticket.id, {
            externalId: '',
            action: 'status_change',
            status: changes.status,
        }, sourceSystem);
    }

    if (changes.priority) {
        await engine.onTicketChange(ticket.id, {
            externalId: '',
            action: 'priority_change',
            priority: changes.priority,
        }, sourceSystem);
    }

    if (changes.assigneeId) {
        await engine.onTicketChange(ticket.id, {
            externalId: '',
            action: 'assignee_change',
            assigneeExternalId: changes.assigneeId,
        }, sourceSystem);
    }

    if (changes.labels) {
        await engine.onTicketChange(ticket.id, {
            externalId: '',
            action: 'label_change',
            labels: changes.labels,
        }, sourceSystem);
    }
}

/**
 * Trigger after a message is added to a ticket.
 *
 * Skips SYSTEM messages — they are internal bookkeeping and should not
 * be pushed to the tracker.
 */
export async function onMessageCreated(
    engine: SyncEngine,
    ticket: SyncTicket,
    message: SyncMessage,
    sourceSystem: string,
): Promise<void> {
    if (message.type === 'SYSTEM') {
        return;
    }

    await engine.onTicketChange(ticket.id, {
        externalId: '',
        action: 'comment',
        comment: message.body,
    }, sourceSystem);
}

// ─── Registration Helper ────────────────────────────────────────────────

/**
 * Convenience re-export of all trigger functions bound to an engine.
 *
 * Returns an object with the same trigger signatures, but with the engine
 * parameter pre-applied — suitable for passing to hooks.
 */
export function registerSyncTriggers(engine: SyncEngine) {
    return {
        onTicketCreated: (ticket: SyncTicket, sourceSystem: string) =>
            onTicketCreated(engine, ticket, sourceSystem),
        onTicketUpdated: (ticket: SyncTicket, changes: TicketChanges, sourceSystem: string) =>
            onTicketUpdated(engine, ticket, changes, sourceSystem),
        onMessageCreated: (ticket: SyncTicket, message: SyncMessage, sourceSystem: string) =>
            onMessageCreated(engine, ticket, message, sourceSystem),
    };
}
