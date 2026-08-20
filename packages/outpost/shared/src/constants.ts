/**
 * Shared constants used across Outpost apps and packages.
 */

/** Ticket ID prefix */
export const TICKET_ID_PREFIX = 'TKT';

/** Ticket ID format regex: TKT-XXXX where X is alphanumeric */
export const TICKET_ID_PATTERN = /^TKT-[A-Z0-9]{4,}$/;

/** Default SLA targets in minutes by priority.
 *  These are fallback defaults; the seed script creates tighter targets
 *  per-account that override these. */
export const DEFAULT_SLA_FIRST_RESPONSE: Record<string, number> = {
    CRITICAL: 15,
    HIGH: 60,
    MEDIUM: 240,
    LOW: 1440,
};

export const DEFAULT_SLA_RESOLUTION: Record<string, number> = {
    CRITICAL: 240,
    HIGH: 480,
    MEDIUM: 2880,
    LOW: 10080,
};

/**
 * AI confidence thresholds.
 *
 * Three groups, and only two of them have readers:
 *   - ESCALATE — live. The pipeline picks the disclaimer on it and the queue
 *     handler enqueues an ESCALATION job below it.
 *   - HIGH_THRESHOLD / MEDIUM_THRESHOLD — live. `classifyConfidence` buckets
 *     responses into tiers for the disclaimer, the dashboard, and analytics.
 *   - AUTO_RESPOND / SUGGEST — NO READER in `src/`. They described an
 *     action-based scheme the pipeline never implemented: every response posts,
 *     and what varies is the disclaimer and whether a human is paged. The last
 *     reader was `GeneratedResponse.autoSend`, removed because it derived from a
 *     pre-deduction score and so read `true` for exactly the responses the
 *     groundedness gate withholds. Kept for the documented band and because
 *     queue/github-app fixtures still reference the numbers; delete both if a
 *     genuine auto-post gate is ever built, rather than wiring them to
 *     something new that happens to want a 0.9 cutoff.
 */
export const AI_CONFIDENCE = {
    /** Above this threshold, auto-respond */
    AUTO_RESPOND: 0.9,
    /** Above this threshold: HIGH confidence (auto-post) */
    HIGH_THRESHOLD: 0.8,
    /** Above this threshold, suggest response */
    SUGGEST: 0.7,
    /** Above this threshold: MEDIUM confidence (post with disclaimer) */
    MEDIUM_THRESHOLD: 0.5,
    /** Below this threshold, escalate to human */
    ESCALATE: 0.4,
} as const;

/** Maximum retry attempts for job queue */
export const MAX_JOB_ATTEMPTS = 5;

/** Base delay for exponential backoff in milliseconds */
export const BACKOFF_BASE_MS = 1000;

/** Maximum backoff delay in milliseconds */
export const BACKOFF_MAX_MS = 300_000;

/** Pagination defaults */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Ticket statuses that a customer (non-team) reply reopens back to OPEN.
 *
 * Every inbound reply path must agree on this set. Since Outpost stopped
 * answering replies (it responds to the opening message only), reopening the
 * ticket is the ONLY signal a reply sends to a human — a path that omits a
 * status here silently drops the customer's follow-up on the floor.
 *
 * Readers: the shared InboundHandler (`platforms/inbound.ts`), the GitHub App
 * issue-comment webhook, and the Postmark inbound-email webhook. Do not inline
 * the literal set anywhere; call `reopensOnCustomerReply` instead.
 */
export const REOPEN_ON_CUSTOMER_REPLY_STATUSES = [
    'WAITING_ON_CUSTOMER',
    'RESOLVED',
    'CLOSED',
] as const satisfies readonly string[];

/**
 * True when a customer reply to a ticket in `status` should reopen it.
 *
 * Takes a plain string (not TicketStatus) because callers read the status
 * straight off a Prisma row, where it is typed as the DB enum / string.
 */
export function reopensOnCustomerReply(status: string | null | undefined): boolean {
    return (REOPEN_ON_CUSTOMER_REPLY_STATUSES as readonly string[]).includes(status ?? '');
}
