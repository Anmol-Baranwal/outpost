import { describe, it, expect } from 'vitest';
import { scoreEngagement } from './engagement.js';
import { EngagementLevel } from './types.js';
import type { AccountMetrics } from './types.js';

describe('scoreEngagement', () => {
    it('should classify a very active account as HIGH engagement', () => {
        const metrics: AccountMetrics = {
            messageCount: 100,
            ticketCount: 15,
            avgMessagesPerDay: 5,
            daysSinceLastActivity: 0,
            responseRate: 90,
            ticketVolumeTrend: 0.3,
        };

        const result = scoreEngagement(metrics);

        expect(result.level).toBe(EngagementLevel.HIGH);
        expect(result.score).toBeGreaterThanOrEqual(65);
        expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should classify a moderately active account as MEDIUM engagement', () => {
        const metrics: AccountMetrics = {
            messageCount: 20,
            ticketCount: 3,
            avgMessagesPerDay: 1,
            daysSinceLastActivity: 5,
            responseRate: 50,
            ticketVolumeTrend: 0,
        };

        const result = scoreEngagement(metrics);

        expect(result.level).toBe(EngagementLevel.MEDIUM);
        expect(result.score).toBeGreaterThanOrEqual(35);
        expect(result.score).toBeLessThan(65);
    });

    it('should classify a barely active account as LOW engagement', () => {
        const metrics: AccountMetrics = {
            messageCount: 3,
            ticketCount: 1,
            avgMessagesPerDay: 0.1,
            daysSinceLastActivity: 20,
            responseRate: 30,
            ticketVolumeTrend: -0.5,
        };

        const result = scoreEngagement(metrics);

        expect(result.level).toBe(EngagementLevel.LOW);
        expect(result.score).toBeGreaterThanOrEqual(10);
        expect(result.score).toBeLessThan(35);
    });

    it('should classify a completely inactive account as INACTIVE', () => {
        const metrics: AccountMetrics = {
            messageCount: 0,
            ticketCount: 0,
            avgMessagesPerDay: 0,
            daysSinceLastActivity: 90,
            responseRate: 0,
            ticketVolumeTrend: 0,
        };

        const result = scoreEngagement(metrics);

        expect(result.level).toBe(EngagementLevel.INACTIVE);
        expect(result.score).toBeLessThan(10);
    });

    it('should clamp score to 0-100 range', () => {
        // Even with extreme values, score stays in bounds
        const extreme: AccountMetrics = {
            messageCount: 10000,
            ticketCount: 500,
            avgMessagesPerDay: 100,
            daysSinceLastActivity: 0,
            responseRate: 100,
            ticketVolumeTrend: 1,
        };

        const result = scoreEngagement(extreme);

        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it('should weight recency heavily: recent activity boosts score', () => {
        const recent: AccountMetrics = {
            messageCount: 5,
            ticketCount: 2,
            avgMessagesPerDay: 0.5,
            daysSinceLastActivity: 1,
            responseRate: 50,
            ticketVolumeTrend: 0,
        };

        const stale: AccountMetrics = {
            ...recent,
            daysSinceLastActivity: 30,
        };

        const recentResult = scoreEngagement(recent);
        const staleResult = scoreEngagement(stale);

        expect(recentResult.score).toBeGreaterThan(staleResult.score);
    });

    it('should increase score with positive volume trend', () => {
        const base: AccountMetrics = {
            messageCount: 10,
            ticketCount: 5,
            avgMessagesPerDay: 1,
            daysSinceLastActivity: 3,
            responseRate: 50,
            ticketVolumeTrend: 0,
        };

        const increasing: AccountMetrics = { ...base, ticketVolumeTrend: 0.8 };
        const decreasing: AccountMetrics = { ...base, ticketVolumeTrend: -0.8 };

        const incResult = scoreEngagement(increasing);
        const decResult = scoreEngagement(decreasing);

        expect(incResult.score).toBeGreaterThan(decResult.score);
    });

    it('should return an integer score', () => {
        const metrics: AccountMetrics = {
            messageCount: 7,
            ticketCount: 3,
            avgMessagesPerDay: 1.3,
            daysSinceLastActivity: 4,
            responseRate: 65,
            ticketVolumeTrend: 0.2,
        };

        const result = scoreEngagement(metrics);

        expect(Number.isInteger(result.score)).toBe(true);
    });
});
