/**
 * Sync adapter interfaces and types.
 *
 * Defines the plugin contract for bidirectional sync between Outpost
 * and external trackers (GitHub, Linear, Zendesk, etc.).
 */

import type { TicketStatus, TicketPriority } from '../types.js';

// ─── Webhook & Change Types ────────────────────────────────────────────────

/** Raw webhook event received from an external tracker. */
export interface WebhookEvent {
    /** Name of the plugin that received this webhook */
    plugin: string;
    /** External event type (e.g. 'issue.opened', 'issue.updated') */
    eventType: string;
    /** Raw payload from the external system */
    payload: Record<string, unknown>;
    /** Headers from the webhook request (for signature verification) */
    headers?: Record<string, string>;
}

/** A normalized change to be applied to an Outpost ticket. */
export interface TicketChange {
    /** The external ID of the entity that changed */
    externalId: string;
    /** What kind of change occurred */
    action: TicketChangeAction;
    /** New status, if the change is a status update */
    status?: TicketStatus;
    /** New priority, if the change is a priority update */
    priority?: TicketPriority;
    /** Comment body, if the change is a comment */
    comment?: string;
    /** New labels, if the change is a label update */
    labels?: string[];
    /** New assignee external user ID, if the change is an assignment */
    assigneeExternalId?: string;
    /** Title for new issues */
    title?: string;
    /** Description for new issues */
    description?: string;
    /** Additional metadata from the external system */
    metadata?: Record<string, unknown>;
}

export type TicketChangeAction =
    | 'status_change'
    | 'comment'
    | 'label_change'
    | 'assignee_change'
    | 'priority_change'
    | 'new_issue'
    | 'close';

// ─── Sync Result ───────────────────────────────────────────────────────────

/** Result of a sync operation (push or webhook processing). */
export interface SyncResult {
    success: boolean;
    /** Number of plugins that were notified */
    pluginsNotified: number;
    /** Errors from individual plugins */
    errors: SyncError[];
}

export interface SyncError {
    plugin: string;
    action: string;
    error: string;
}

// ─── External Link Reference ───────────────────────────────────────────────

/** Lightweight reference to a TicketExternalLink row. */
export interface TicketExternalLinkRef {
    id: string;
    ticketId: string;
    plugin: string;
    externalId: string;
    externalUrl?: string | null;
    metadata?: Record<string, unknown> | null;
}

// ─── Team Member Reference ─────────────────────────────────────────────────

/** Lightweight reference to a TeamMember for sync operations. */
export interface TeamMemberRef {
    id: string;
    name: string;
    email: string;
}

// ─── Plugin Interfaces ─────────────────────────────────────────────────────

/**
 * Base plugin interface for external trackers that support
 * bidirectional status/comment/label sync.
 *
 * An ExternalTracker handles webhooks from the external system and
 * can push changes back to it. Status mapping is required; other
 * push operations are best-effort.
 */
export interface ExternalTracker {
    /** Unique plugin name (e.g. 'github', 'gitlab', 'zendesk') */
    name: string;

    /** Parse an incoming webhook and return a normalized change, or null to skip. */
    onWebhookReceived(event: WebhookEvent): Promise<TicketChange | null>;

    /** Push a status change to the external system. */
    pushStatusChange(link: TicketExternalLinkRef, status: TicketStatus): Promise<void>;

    /** Push a comment to the external system. */
    pushComment(link: TicketExternalLinkRef, message: string): Promise<void>;

    /** Push label changes to the external system. */
    pushLabels(link: TicketExternalLinkRef, labels: string[]): Promise<void>;

    /** Map an external status string to an Outpost TicketStatus. */
    mapStatusToOutpost(externalStatus: string): TicketStatus;

    /** Map an Outpost TicketStatus to the external system's status string. */
    mapStatusFromOutpost(status: TicketStatus): string;
}

/**
 * Extended plugin interface for "internal" trackers (e.g. Linear, Jira)
 * that act as the team's primary issue tracker.
 *
 * InternalTrackers can create issues, assign members, and map priorities
 * in addition to everything ExternalTracker does.
 */
export interface InternalTracker extends ExternalTracker {
    /** Create a new issue in the external system. Returns the external ID. */
    pushNewIssue(ticket: {
        id: string;
        title: string;
        description: string;
        status: TicketStatus;
        priority: TicketPriority;
    }): Promise<string>;

    /** Push an assignee change to the external system. */
    pushAssignee(link: TicketExternalLinkRef, member: TeamMemberRef): Promise<void>;

    /** Push a priority change to the external system. */
    pushPriority(link: TicketExternalLinkRef, priority: TicketPriority): Promise<void>;

    /** Map an external priority string to an Outpost TicketPriority. */
    mapPriorityToOutpost(externalPriority: string): TicketPriority;

    /** Map an Outpost TicketPriority to the external system's priority string. */
    mapPriorityFromOutpost(priority: TicketPriority): string;

    /** Map an external user ID to an Outpost TeamMember, or null if not found. */
    mapUserToMember(externalUserId: string): Promise<TeamMemberRef | null>;
}
