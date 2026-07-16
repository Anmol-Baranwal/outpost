/**
 * Shared types for ticket components, matching the API response shapes.
 */
import type {
    TicketStatus,
    TicketPriority,
    TicketType,
    TicketSource,
    MessageType,
} from '@copilotkit/outpost/shared';

export interface TicketMessage {
    id: string;
    ticketId: string;
    author: string;
    content: string;
    type: MessageType;
    isAiGenerated: boolean;
    confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    attachments: Array<{ name: string; url: string; size: string }> | null;
    createdAt: string;
}

export interface TicketNote {
    id: string;
    ticketId: string;
    author: string;
    content: string;
    createdAt: string;
}

export interface Account {
    id: string;
    name: string;
    domain: string | null;
    acv: number | null;
    createdAt: string;
    [key: string]: unknown; // API may include extra fields like owner, sentiment, etc.
}

export interface TicketUser {
    id: string;
    name: string;
    email: string;
}

export interface TeamMember {
    id: string;
    name: string;
    email: string;
    role: string;
    avatarUrl: string | null;
    status?: string;
}

export interface DiscussionMessage {
    id: string;
    discussionId: string;
    author: string;
    content: string;
    createdAt: string;
}

export interface Discussion {
    id: string;
    ticketId: string;
    title: string;
    messages: DiscussionMessage[];
    createdAt: string;
}

/**
 * Ticket shape from the list API (GET /api/tickets).
 * Messages array has at most 1 entry (the latest).
 * Does not include notes or discussions.
 */
export interface Ticket {
    id: string;
    displayId: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    type: TicketType;
    source: TicketSource;
    sourceUrl: string | null;
    additionalInfo: Record<string, string> | null;
    suggestedResponse: string | null;
    assigneeId: string | null;
    assignee: TeamMember | null;
    accountId: string | null;
    account: Account | null;
    userId: string | null;
    user: TicketUser | null;
    messages: TicketMessage[];
    slaBreachedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * Ticket shape from the detail API (GET /api/tickets/[id]).
 * Includes all messages, notes, and discussions.
 */
export interface TicketDetail extends Ticket {
    notes: TicketNote[];
    discussions: Discussion[];
}
