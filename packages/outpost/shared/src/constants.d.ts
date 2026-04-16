/**
 * Shared constants used across Outpost apps and packages.
 */
/** Ticket ID prefix */
export declare const TICKET_ID_PREFIX = "TKT";
/** Ticket ID format regex: TKT-XXXX where X is alphanumeric */
export declare const TICKET_ID_PATTERN: RegExp;
/** Default SLA targets in minutes by priority.
 *  These are fallback defaults; the seed script creates tighter targets
 *  per-account that override these. */
export declare const DEFAULT_SLA_FIRST_RESPONSE: Record<string, number>;
export declare const DEFAULT_SLA_RESOLUTION: Record<string, number>;
/**
 * AI confidence thresholds.
 *
 * Two overlapping schemes coexist here:
 *   - Action-based (AUTO_RESPOND / SUGGEST / ESCALATE): used by the
 *     response-generation pipeline to decide what action to take.
 *   - Level-based (HIGH_THRESHOLD / MEDIUM_THRESHOLD): used by the
 *     dashboard and analytics to bucket responses into confidence tiers.
 */
export declare const AI_CONFIDENCE: {
    /** Above this threshold, auto-respond */
    readonly AUTO_RESPOND: 0.9;
    /** Above this threshold: HIGH confidence (auto-post) */
    readonly HIGH_THRESHOLD: 0.8;
    /** Above this threshold, suggest response */
    readonly SUGGEST: 0.7;
    /** Above this threshold: MEDIUM confidence (post with disclaimer) */
    readonly MEDIUM_THRESHOLD: 0.5;
    /** Below this threshold, escalate to human */
    readonly ESCALATE: 0.4;
};
/** Maximum retry attempts for job queue */
export declare const MAX_JOB_ATTEMPTS = 5;
/** Base delay for exponential backoff in milliseconds */
export declare const BACKOFF_BASE_MS = 1000;
/** Maximum backoff delay in milliseconds */
export declare const BACKOFF_MAX_MS = 300000;
/** Pagination defaults */
export declare const DEFAULT_PAGE_SIZE = 25;
export declare const MAX_PAGE_SIZE = 100;
//# sourceMappingURL=constants.d.ts.map