/**
 * AI enrichment fan-out — pushes AI classification and response
 * results to the internal tracker via sync triggers.
 *
 * Called after the AI pipeline classifies a ticket, generates a response,
 * or routing assigns a team member. Each function fires the appropriate
 * sync trigger so the internal tracker stays in sync with AI decisions.
 */

import type { SyncEngine } from './engine.js';
import type { SyncTicket, TicketChanges } from './triggers.js';
import { onTicketUpdated, onMessageCreated } from './triggers.js';
import { MessageType } from '../types.js';
import type { TicketPriority, TicketStatus } from '../types.js';

// ─── Source identifier for AI-originated changes ────────────────────────

const AI_SOURCE = 'ai';

// ─── Classification Results ─────────────────────────────────────────────

export interface ClassificationResult {
    priority?: TicketPriority;
    status?: TicketStatus;
    labels?: string[];
}

// ─── Fan-Out Functions ──────────────────────────────────────────────────

/**
 * Push AI classification results (priority, status, labels) to the
 * internal tracker.
 *
 * Only pushes fields that are present in the result — omitted fields
 * are not synced.
 */
export async function onAiClassification(
    engine: SyncEngine,
    ticket: SyncTicket,
    result: ClassificationResult,
): Promise<void> {
    const changes: TicketChanges = {};
    let hasChanges = false;

    if (result.priority) {
        changes.priority = result.priority;
        hasChanges = true;
    }

    if (result.status) {
        changes.status = result.status;
        hasChanges = true;
    }

    if (result.labels && result.labels.length > 0) {
        changes.labels = result.labels;
        hasChanges = true;
    }

    if (!hasChanges) {
        return;
    }

    await onTicketUpdated(engine, ticket, changes, AI_SOURCE);
}

/**
 * Push an AI-generated response as a comment to the internal tracker.
 */
export async function onAiResponse(
    engine: SyncEngine,
    ticket: SyncTicket,
    responseBody: string,
): Promise<void> {
    await onMessageCreated(engine, ticket, {
        id: `ai-response-${Date.now()}`,
        body: responseBody,
        type: MessageType.BOT,
    }, AI_SOURCE);
}

/**
 * Push a routing assignment (team member) to the internal tracker.
 */
export async function onRoutingAssignment(
    engine: SyncEngine,
    ticket: SyncTicket,
    assigneeId: string,
): Promise<void> {
    await onTicketUpdated(engine, ticket, { assigneeId }, AI_SOURCE);
}
