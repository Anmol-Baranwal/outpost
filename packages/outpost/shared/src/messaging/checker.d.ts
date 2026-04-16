/**
 * Messaging urgency checker.
 * Determines urgency level and finds overdue messages (unanswered > 4 hours).
 */
import { type PendingMessage, UrgencyLevel } from './types.js';
/**
 * Calculate the urgency level for a pending message based on how long
 * it has gone unanswered.
 */
export declare function getUrgencyLevel(message: PendingMessage, now?: Date): UrgencyLevel;
/**
 * How many milliseconds a message has been unanswered.
 */
export declare function getUnansweredDurationMs(message: PendingMessage, now?: Date): number;
/**
 * Return all messages that have been unanswered for more than 4 hours.
 */
export declare function checkUnansweredMessages(messages: PendingMessage[], now?: Date): PendingMessage[];
/**
 * Format a duration in milliseconds to a human-readable string.
 * e.g. "2h 15m", "45m", "6h 0m"
 */
export declare function formatMessageDuration(ms: number): string;
//# sourceMappingURL=checker.d.ts.map