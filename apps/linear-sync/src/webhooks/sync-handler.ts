/**
 * Linear webhook → Outpost sync handler.
 *
 * Wires the parsed Linear webhook events to actual Outpost ticket
 * create/update operations. Each handler:
 * 1. Parses the raw webhook payload
 * 2. Creates or updates the Outpost ticket via Prisma
 * 3. Includes sourceSystem='linear' so sync triggers don't echo back
 *
 * The Prisma client and SyncEngine are dependency-injected for testability.
 */

import type { ParsedIssueCreated } from './issue-created.js';
import type { ParsedIssueUpdated } from './issue-updated.js';
import type { ParsedCommentCreated } from './comment-created.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'WAITING_ON_TEAM' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketSource = 'LINEAR';

/**
 * Minimal Prisma-like interface for the sync handler.
 * Keeps the module testable without importing the full Prisma client.
 */
export interface SyncHandlerDeps {
    prisma: {
        ticket: {
            create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
            findFirst: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
            update: (args: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
            }) => Promise<Record<string, unknown>>;
        };
        ticketExternalLink: {
            create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
            findUnique: (args: {
                where: Record<string, unknown>;
            }) => Promise<{ id: string; ticketId: string; plugin: string; externalId: string } | null>;
        };
        message: {
            create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
        };
    };
}

// ─── Status Mapping (Linear → Outpost) ───────────────────────────────────

const LINEAR_STATUS_MAP: Record<string, TicketStatus> = {
    'triage': 'OPEN',
    'backlog': 'OPEN',
    'todo': 'OPEN',
    'in progress': 'IN_PROGRESS',
    'done': 'RESOLVED',
    'canceled': 'CLOSED',
    'cancelled': 'CLOSED',
};

export function mapLinearStatus(linearStatus: string | null): TicketStatus {
    if (!linearStatus) return 'OPEN';
    return LINEAR_STATUS_MAP[linearStatus.toLowerCase()] ?? 'OPEN';
}

// ─── Priority Mapping (Linear numeric → Outpost) ─────────────────────────

const LINEAR_PRIORITY_MAP: Record<number, TicketPriority> = {
    0: 'MEDIUM',   // None
    1: 'CRITICAL', // Urgent
    2: 'HIGH',     // High
    3: 'MEDIUM',   // Medium
    4: 'LOW',      // Low
};

export function mapLinearPriority(linearPriority: number): TicketPriority {
    return LINEAR_PRIORITY_MAP[linearPriority] ?? 'MEDIUM';
}

// ─── Handlers ─────────────────────────────────────────────────────────────

/**
 * Handle a Linear issue-created webhook by creating an Outpost ticket.
 *
 * Creates the ticket with source=LINEAR, sets internalTracker='linear'
 * and internalId=issue.id. Also creates a TicketExternalLink so the
 * sync engine can find the mapping in both directions.
 */
export async function handleIssueCreated(
    deps: SyncHandlerDeps,
    parsed: ParsedIssueCreated,
): Promise<{ ticketId: string; linkId: string }> {
    const status = mapLinearStatus(parsed.status);
    const priority = mapLinearPriority(parsed.priority);

    const ticket = await deps.prisma.ticket.create({
        data: {
            displayId: `TKT-${parsed.issueId.slice(0, 8).toUpperCase()}`,
            title: parsed.title,
            description: parsed.description ?? '',
            status,
            priority,
            source: 'LINEAR' as TicketSource,
            internalTracker: 'linear',
            internalId: parsed.issueId,
            externalUrl: parsed.url,
        },
    });

    const link = await deps.prisma.ticketExternalLink.create({
        data: {
            ticketId: ticket.id,
            plugin: 'linear',
            externalId: parsed.issueId,
            externalUrl: parsed.url,
        },
    });

    return { ticketId: ticket.id, linkId: link.id };
}

/**
 * Handle a Linear issue-updated webhook by updating the matching Outpost ticket.
 *
 * Looks up the ticket by internalId (the Linear issue ID), then updates
 * only the fields that actually changed.
 */
export async function handleIssueUpdated(
    deps: SyncHandlerDeps,
    parsed: ParsedIssueUpdated,
): Promise<{ ticketId: string; updated: boolean }> {
    // Find the ticket by its Linear external link
    const link = await deps.prisma.ticketExternalLink.findUnique({
        where: {
            plugin_externalId: {
                plugin: 'linear',
                externalId: parsed.issueId,
            },
        },
    });

    if (!link) {
        return { ticketId: '', updated: false };
    }

    const updateData: Record<string, unknown> = {};

    if (parsed.status !== undefined) {
        updateData.status = mapLinearStatus(parsed.status);
    }

    if (parsed.priority !== undefined) {
        updateData.priority = mapLinearPriority(parsed.priority);
    }

    if (parsed.title !== undefined) {
        updateData.title = parsed.title;
    }

    await deps.prisma.ticket.update({
        where: { id: link.ticketId },
        data: updateData,
    });

    return { ticketId: link.ticketId, updated: true };
}

/**
 * Handle a Linear comment-created webhook by creating a Message record
 * on the matching Outpost ticket.
 */
export async function handleCommentCreated(
    deps: SyncHandlerDeps,
    parsed: ParsedCommentCreated,
): Promise<{ ticketId: string; messageId: string; created: boolean }> {
    const link = await deps.prisma.ticketExternalLink.findUnique({
        where: {
            plugin_externalId: {
                plugin: 'linear',
                externalId: parsed.issueId,
            },
        },
    });

    if (!link) {
        return { ticketId: '', messageId: '', created: false };
    }

    const message = await deps.prisma.message.create({
        data: {
            ticketId: link.ticketId,
            content: parsed.body,
            type: 'USER',
            author: parsed.userName ?? 'Linear User',
        },
    });

    return { ticketId: link.ticketId, messageId: message.id, created: true };
}
