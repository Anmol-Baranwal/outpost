import { TICKET_ID_PREFIX, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from './constants.js';

/**
 * Generate a unique ticket ID in the format TKT-XXXX.
 * Uses a combination of timestamp and random characters for uniqueness.
 */
export function generateTicketId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit ambiguous chars
    let id = '';
    for (let i = 0; i < 4; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${TICKET_ID_PREFIX}-${id}`;
}

/**
 * Format a duration in minutes to a human-readable string.
 */
export function formatDuration(minutes: number): string {
    if (minutes < 1) {
        return 'less than a minute';
    }
    if (minutes < 60) {
        return `${Math.round(minutes)}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    if (hours < 24) {
        return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoff(attempt: number): number {
    const exponentialDelay = BACKOFF_BASE_MS * Math.pow(2, attempt);
    const jitter = Math.random() * BACKOFF_BASE_MS;
    return Math.min(exponentialDelay + jitter, BACKOFF_MAX_MS);
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
}

/**
 * Extract a domain from an email address.
 */
export function domainFromEmail(email: string): string {
    const parts = email.split('@');
    return parts[1] ?? '';
}

/**
 * Check if an SLA has been breached based on creation time and target minutes.
 */
export function isSlaBreached(createdAt: Date, targetMinutes: number): boolean {
    const elapsedMs = Date.now() - createdAt.getTime();
    const targetMs = targetMinutes * 60 * 1000;
    return elapsedMs > targetMs;
}
