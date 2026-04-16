/**
 * Generate a unique ticket ID in the format TKT-XXXXXXXX.
 * Uses 8 random characters from a 32-char alphabet (~1.1 trillion keyspace)
 * to make collisions negligible at scale.
 */
export declare function generateTicketId(): string;
/**
 * Format a duration in minutes to a human-readable string.
 */
export declare function formatDuration(minutes: number): string;
/**
 * Calculate exponential backoff delay with jitter.
 */
export declare function calculateBackoff(attempt: number): number;
/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 */
export declare function truncate(str: string, maxLength: number): string;
/**
 * Extract a domain from an email address.
 */
export declare function domainFromEmail(email: string): string;
/**
 * Check if an SLA has been breached based on creation time and target minutes.
 */
export declare function isSlaBreached(createdAt: Date, targetMinutes: number): boolean;
//# sourceMappingURL=utils.d.ts.map