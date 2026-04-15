/**
 * Shared constants used across Outpost apps and packages.
 */

/** Ticket ID prefix */
export const TICKET_ID_PREFIX = 'TKT';

/** Ticket ID format regex: TKT-XXXX where X is alphanumeric */
export const TICKET_ID_PATTERN = /^TKT-[A-Z0-9]{4,}$/;

/** Default SLA targets in minutes by priority */
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

/** AI confidence thresholds */
export const AI_CONFIDENCE = {
    /** Above this threshold, auto-respond */
    AUTO_RESPOND: 0.9,
    /** Above this threshold, suggest response */
    SUGGEST: 0.7,
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
