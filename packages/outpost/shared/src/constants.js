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
export const DEFAULT_SLA_FIRST_RESPONSE = {
    CRITICAL: 15,
    HIGH: 60,
    MEDIUM: 240,
    LOW: 1440,
};
export const DEFAULT_SLA_RESOLUTION = {
    CRITICAL: 240,
    HIGH: 480,
    MEDIUM: 2880,
    LOW: 10080,
};
/**
 * AI confidence thresholds.
 *
 * Two overlapping schemes coexist here:
 *   - Action-based (AUTO_RESPOND / SUGGEST / ESCALATE): used by the
 *     response-generation pipeline to decide what action to take.
 *   - Level-based (HIGH_THRESHOLD / MEDIUM_THRESHOLD): used by the
 *     dashboard and analytics to bucket responses into confidence tiers.
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
};
/** Maximum retry attempts for job queue */
export const MAX_JOB_ATTEMPTS = 5;
/** Base delay for exponential backoff in milliseconds */
export const BACKOFF_BASE_MS = 1000;
/** Maximum backoff delay in milliseconds */
export const BACKOFF_MAX_MS = 300_000;
/** Pagination defaults */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
