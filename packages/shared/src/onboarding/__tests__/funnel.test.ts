import { describe, it, expect } from 'vitest';
import {
    FunnelStage,
    flagsForStage,
    isValidTransition,
    computeFunnelMetrics,
} from '../index.js';
import type { OnboardingMember } from '../types.js';

function makeMember(stage: FunnelStage, overrides: Partial<OnboardingMember> = {}): OnboardingMember {
    return {
        id: `om-${Math.random().toString(36).slice(2, 6)}`,
        discordId: `d-${Math.random().toString(36).slice(2, 6)}`,
        username: 'testuser#1234',
        joinedAt: new Date().toISOString(),
        funnelStage: stage,
        contacted: stage !== FunnelStage.JOINED,
        responded: stage === FunnelStage.RESPONDED || stage === FunnelStage.MEETING_BOOKED,
        meetingBooked: stage === FunnelStage.MEETING_BOOKED,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

describe('flagsForStage', () => {
    it('returns all false for JOINED stage', () => {
        const flags = flagsForStage(FunnelStage.JOINED);
        expect(flags).toEqual({
            contacted: false,
            responded: false,
            meetingBooked: false,
        });
    });

    it('returns contacted=true for CONTACTED stage', () => {
        const flags = flagsForStage(FunnelStage.CONTACTED);
        expect(flags).toEqual({
            contacted: true,
            responded: false,
            meetingBooked: false,
        });
    });

    it('returns contacted and responded for RESPONDED stage', () => {
        const flags = flagsForStage(FunnelStage.RESPONDED);
        expect(flags).toEqual({
            contacted: true,
            responded: true,
            meetingBooked: false,
        });
    });

    it('returns all true for MEETING_BOOKED stage', () => {
        const flags = flagsForStage(FunnelStage.MEETING_BOOKED);
        expect(flags).toEqual({
            contacted: true,
            responded: true,
            meetingBooked: true,
        });
    });
});

describe('isValidTransition', () => {
    it('allows same-stage transition', () => {
        expect(isValidTransition(FunnelStage.JOINED, FunnelStage.JOINED)).toBe(true);
    });

    it('allows forward transition', () => {
        expect(isValidTransition(FunnelStage.JOINED, FunnelStage.CONTACTED)).toBe(true);
        expect(isValidTransition(FunnelStage.CONTACTED, FunnelStage.MEETING_BOOKED)).toBe(true);
    });

    it('rejects backward transition', () => {
        expect(isValidTransition(FunnelStage.CONTACTED, FunnelStage.JOINED)).toBe(false);
        expect(isValidTransition(FunnelStage.MEETING_BOOKED, FunnelStage.RESPONDED)).toBe(false);
    });

    it('allows skipping stages', () => {
        expect(isValidTransition(FunnelStage.JOINED, FunnelStage.MEETING_BOOKED)).toBe(true);
    });
});

describe('computeFunnelMetrics', () => {
    it('returns zeroes for empty member list', () => {
        const metrics = computeFunnelMetrics([]);
        expect(metrics.totalMembers).toBe(0);
        expect(metrics.stageCounts.JOINED).toBe(0);
        expect(metrics.stageCounts.CONTACTED).toBe(0);
        expect(metrics.stageCounts.RESPONDED).toBe(0);
        expect(metrics.stageCounts.MEETING_BOOKED).toBe(0);
        expect(metrics.conversionRates.joinedToContacted).toBe(0);
    });

    it('counts members cumulatively through stages', () => {
        const members = [
            makeMember(FunnelStage.JOINED),
            makeMember(FunnelStage.CONTACTED),
            makeMember(FunnelStage.RESPONDED),
            makeMember(FunnelStage.MEETING_BOOKED),
        ];

        const metrics = computeFunnelMetrics(members);

        // JOINED: everyone counts (all 4 have passed JOINED)
        expect(metrics.stageCounts.JOINED).toBe(4);
        // CONTACTED: 3 (CONTACTED + RESPONDED + MEETING_BOOKED)
        expect(metrics.stageCounts.CONTACTED).toBe(3);
        // RESPONDED: 2 (RESPONDED + MEETING_BOOKED)
        expect(metrics.stageCounts.RESPONDED).toBe(2);
        // MEETING_BOOKED: 1
        expect(metrics.stageCounts.MEETING_BOOKED).toBe(1);
        expect(metrics.totalMembers).toBe(4);
    });

    it('computes conversion rates correctly', () => {
        const members = [
            makeMember(FunnelStage.JOINED),
            makeMember(FunnelStage.JOINED),
            makeMember(FunnelStage.CONTACTED),
            makeMember(FunnelStage.RESPONDED),
        ];

        const metrics = computeFunnelMetrics(members);

        // Joined: 4, Contacted: 2, Responded: 1, Meeting: 0
        expect(metrics.conversionRates.joinedToContacted).toBe(50); // 2/4 = 50%
        expect(metrics.conversionRates.contactedToResponded).toBe(50); // 1/2 = 50%
        expect(metrics.conversionRates.respondedToMeetingBooked).toBe(0); // 0/1 = 0%
    });

    it('handles all members at same stage', () => {
        const members = [
            makeMember(FunnelStage.JOINED),
            makeMember(FunnelStage.JOINED),
            makeMember(FunnelStage.JOINED),
        ];

        const metrics = computeFunnelMetrics(members);

        expect(metrics.stageCounts.JOINED).toBe(3);
        expect(metrics.stageCounts.CONTACTED).toBe(0);
        expect(metrics.conversionRates.joinedToContacted).toBe(0);
        expect(metrics.totalMembers).toBe(3);
    });

    it('handles single member at final stage', () => {
        const members = [makeMember(FunnelStage.MEETING_BOOKED)];

        const metrics = computeFunnelMetrics(members);

        expect(metrics.stageCounts.JOINED).toBe(1);
        expect(metrics.stageCounts.CONTACTED).toBe(1);
        expect(metrics.stageCounts.RESPONDED).toBe(1);
        expect(metrics.stageCounts.MEETING_BOOKED).toBe(1);
        expect(metrics.conversionRates.joinedToContacted).toBe(100);
        expect(metrics.conversionRates.contactedToResponded).toBe(100);
        expect(metrics.conversionRates.respondedToMeetingBooked).toBe(100);
    });
});
