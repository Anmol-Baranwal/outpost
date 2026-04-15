/**
 * Engagement scorer for account health monitoring.
 *
 * Uses a weighted heuristic formula based on activity metrics to compute
 * an engagement score (0-100) and classify accounts into engagement levels.
 * No Claude calls needed — pure computation.
 */

import type { AccountMetrics, EngagementResult } from './types.js';
import { EngagementLevel } from './types.js';

/**
 * Weight configuration for the engagement formula.
 * All weights sum to 1.0.
 */
const WEIGHTS = {
    /** How often the account is messaging */
    messageFrequency: 0.25,
    /** Whether messages get replies */
    responseRate: 0.20,
    /** Volume of support tickets */
    ticketVolume: 0.15,
    /** How recently the account was active */
    recency: 0.25,
    /** Trend in activity (increasing = more engaged) */
    trend: 0.15,
} as const;

/**
 * Thresholds for engagement level classification.
 */
const THRESHOLDS = {
    high: 65,
    medium: 35,
    low: 10,
} as const;

/**
 * Score an account's engagement level based on activity metrics.
 *
 * The formula is a weighted combination of:
 * - Message frequency (normalized against expected daily activity)
 * - Response rate (percentage of messages that received replies)
 * - Ticket volume (normalized, with diminishing returns)
 * - Recency of activity (exponential decay)
 * - Volume trend (increasing activity = higher engagement)
 */
export function scoreEngagement(metrics: AccountMetrics): EngagementResult {
    const frequencyScore = scoreMessageFrequency(metrics.avgMessagesPerDay);
    const responseScore = metrics.responseRate; // Already 0-100
    const ticketScore = scoreTicketVolume(metrics.ticketCount);
    const recencyScore = scoreRecency(metrics.daysSinceLastActivity);
    const trendScore = scoreTrend(metrics.ticketVolumeTrend);

    const weighted =
        frequencyScore * WEIGHTS.messageFrequency +
        responseScore * WEIGHTS.responseRate +
        ticketScore * WEIGHTS.ticketVolume +
        recencyScore * WEIGHTS.recency +
        trendScore * WEIGHTS.trend;

    const score = Math.max(0, Math.min(100, Math.round(weighted)));
    const level = levelFromScore(score);

    return { score, level };
}

/**
 * Normalize message frequency to a 0-100 scale.
 * - 0 msgs/day = 0
 * - 2 msgs/day = 50 (moderate engagement)
 * - 5+ msgs/day = 100 (very active)
 * Uses a logarithmic curve for diminishing returns.
 */
function scoreMessageFrequency(avgPerDay: number): number {
    if (avgPerDay <= 0) return 0;
    // log2(1 + avgPerDay) / log2(6) * 100, capped at 100
    const normalized = (Math.log2(1 + avgPerDay) / Math.log2(6)) * 100;
    return Math.min(100, normalized);
}

/**
 * Normalize ticket volume to a 0-100 scale.
 * More tickets generally = more engaged (they're using the product).
 * - 0 tickets = 0
 * - 5 tickets = ~50
 * - 15+ tickets = 100
 */
function scoreTicketVolume(ticketCount: number): number {
    if (ticketCount <= 0) return 0;
    const normalized = (Math.log2(1 + ticketCount) / Math.log2(16)) * 100;
    return Math.min(100, normalized);
}

/**
 * Score recency of activity using exponential decay.
 * - 0 days ago = 100
 * - 7 days ago = ~50
 * - 30 days ago = ~10
 * - 90+ days ago = ~0
 */
function scoreRecency(daysSinceLastActivity: number): number {
    if (daysSinceLastActivity <= 0) return 100;
    // Exponential decay with half-life of ~7 days
    return Math.max(0, 100 * Math.exp(-0.1 * daysSinceLastActivity));
}

/**
 * Score the trend in ticket volume.
 * - Positive trend (increasing) = higher engagement
 * - Negative trend (decreasing) = lower engagement
 * - Maps from roughly -1..+1 to 0..100
 */
function scoreTrend(ticketVolumeTrend: number): number {
    // Clamp trend to -1..+1 range, then map to 0..100
    const clamped = Math.max(-1, Math.min(1, ticketVolumeTrend));
    return (clamped + 1) * 50;
}

function levelFromScore(score: number): EngagementLevel {
    if (score >= THRESHOLDS.high) return EngagementLevel.HIGH;
    if (score >= THRESHOLDS.medium) return EngagementLevel.MEDIUM;
    if (score >= THRESHOLDS.low) return EngagementLevel.LOW;
    return EngagementLevel.INACTIVE;
}
