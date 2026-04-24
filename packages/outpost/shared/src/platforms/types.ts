/**
 * Platform Adapter types — the single abstraction for all platform I/O in Outpost.
 *
 * Every bot (Discord, Slack, GitHub, Teams, Email) normalizes inbound events
 * to an InboundMessage and writes responses via PlatformAdapter.postResponse.
 */

import type { TicketSource, PlatformTarget } from '../types.js';

// Re-export for convenience
export type { TicketSource, PlatformTarget };

// ─── Inbound Message ──────────────────────────────────────────────────────

/** A platform-agnostic representation of an incoming message from any source. */
export interface InboundMessage {
    /** The user's platform-specific ID (Discord user ID, Slack user ID, GitHub login, etc.) */
    platformUserId: string;
    /** The user's display name on the platform */
    platformUsername: string;
    /** The message text content */
    content: string;
    /** Thread/conversation identifier (Discord thread ID, GitHub issue number, Slack thread_ts, etc.) */
    threadId?: string;
    /** Source channel/repo/conversation */
    channelId?: string;
    /** Deep link to the original message on the platform */
    sourceUrl?: string;
    /** Which platform this message came from */
    source: TicketSource;
    /** File attachments on the message */
    attachments?: Attachment[];
    /** true = new ticket (thread start, new issue, top-level message), false = reply to existing */
    isThreadStart: boolean;
    /** The original raw event from the platform SDK, preserved for platform-specific handling */
    rawEvent: unknown;
}

// ─── Platform User ────────────────────────────────────────────────────────

/** Normalized user info fetched from a platform. */
export interface PlatformUser {
    /** Platform-specific user ID */
    platformId: string;
    /** Username/handle on the platform */
    username: string;
    /** Human-readable display name if different from username */
    displayName?: string;
    /** Email address if available from the platform */
    email?: string;
    /** URL to the user's avatar image */
    avatarUrl?: string;
}

// ─── Attachment ───────────────────────────────────────────────────────────

/** A file attachment on an inbound message. */
export interface Attachment {
    /** Original filename */
    filename: string;
    /** URL where the file can be downloaded */
    url: string;
    /** File size in bytes, if known */
    size?: number;
    /** MIME content type, if known */
    contentType?: string;
}

// ─── Formatted Response (re-export from AI types) ─────────────────────────

/**
 * Inline definition matching the AI package's FormattedResponse.
 * We duplicate here to avoid a circular dependency between shared and ai.
 */
export interface FormattedResponse {
    /** The formatted response text */
    text: string;
    /** Action buttons metadata (for Discord bot) */
    buttons?: Array<{ label: string; action: string }>;
    /** Whether the response was truncated */
    truncated?: boolean;
    /** Split messages (for Discord 2000-char limit) */
    parts?: string[];
}

// ─── Platform Adapter Interface ───────────────────────────────────────────

/**
 * The contract every platform adapter must implement.
 *
 * Adapters are stateless HTTP wrappers (no WebSocket connections).
 * They translate between Outpost's internal types and each platform's API.
 */
export interface PlatformAdapter {
    /** Which platform this adapter handles */
    readonly platform: TicketSource;

    /**
     * Normalize a raw platform event into the common InboundMessage shape.
     * Each adapter knows how to destructure its platform's webhook payload.
     */
    parseInboundEvent(rawEvent: unknown): InboundMessage;

    /**
     * Fetch user info from the platform API.
     * Used to enrich ticket/user records.
     */
    fetchUserInfo(platformUserId: string): Promise<PlatformUser>;

    /**
     * Post a formatted AI response back to the platform thread/issue/conversation.
     * The ticket carries sourceId and channel info needed to route the message.
     */
    postResponse(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        response: FormattedResponse,
    ): Promise<void>;

    /**
     * Post a system-level message (acknowledgments, status updates, errors).
     */
    postSystemMessage(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        message: string,
    ): Promise<void>;
}

// ─── Ticket Shape (minimal, for adapter use) ─────────────────────────────

/** The ticket fields adapters and InboundHandler need. */
export interface TicketRef {
    id: string;
    displayId: string;
    status: string;
    sourceId: string | null;
    channel: string | null;
    source: TicketSource;
}

// ─── Inbound Handler Result ──────────────────────────────────────────────

/** The result of processing an inbound message through the handler. */
export interface InboundResult {
    /** The ticket that was created or updated */
    ticketId: string;
    /** The display ID of the ticket (TKT-XXXXXXXX) */
    displayId: string;
    /** Whether a new ticket was created (vs reply appended to existing) */
    isNewTicket: boolean;
    /** Whether an AI_RESPONSE job was enqueued */
    aiJobEnqueued: boolean;
    /** The message record ID that was created, or null if no message was created */
    messageId: string | null;
}
