/**
 * Conversion funnel tracking logic for community onboarding.
 *
 * Pure functions that compute funnel stage transitions and metrics.
 * Database interactions are left to the caller.
 */

import {
    FunnelStage,
    FUNNEL_STAGE_ORDER,
} from './types.js';
import type {
    OnboardingMember,
    FunnelMetrics,
} from './types.js';

/**
 * Determine the boolean flags that should be set for a given funnel stage.
 * Each stage implies all previous stages are also true.
 */
export function flagsForStage(stage: FunnelStage): {
    contacted: boolean;
    responded: boolean;
    meetingBooked: boolean;
} {
    const idx = FUNNEL_STAGE_ORDER.indexOf(stage);
    return {
        contacted: idx >= 1,
        responded: idx >= 2,
        meetingBooked: idx >= 3,
    };
}

/**
 * Validate that a stage transition is valid (can only move forward).
 * Returns true if newStage is ahead of or equal to currentStage.
 */
export function isValidTransition(currentStage: FunnelStage, newStage: FunnelStage): boolean {
    const currentIdx = FUNNEL_STAGE_ORDER.indexOf(currentStage);
    const newIdx = FUNNEL_STAGE_ORDER.indexOf(newStage);
    return newIdx >= currentIdx;
}

/**
 * Compute conversion funnel metrics from a list of onboarding members.
 */
export function computeFunnelMetrics(members: OnboardingMember[]): FunnelMetrics {
    const stageCounts: Record<FunnelStage, number> = {
        [FunnelStage.JOINED]: 0,
        [FunnelStage.CONTACTED]: 0,
        [FunnelStage.RESPONDED]: 0,
        [FunnelStage.MEETING_BOOKED]: 0,
    };

    for (const member of members) {
        // Each member at a given stage also counts toward all previous stages
        const idx = FUNNEL_STAGE_ORDER.indexOf(member.funnelStage);
        for (let i = 0; i <= idx; i++) {
            stageCounts[FUNNEL_STAGE_ORDER[i]]++;
        }
    }

    const total = members.length;

    function conversionRate(from: number, to: number): number {
        if (from === 0) return 0;
        return Math.round((to / from) * 10000) / 100; // two decimal places
    }

    return {
        stageCounts,
        conversionRates: {
            joinedToContacted: conversionRate(
                stageCounts[FunnelStage.JOINED],
                stageCounts[FunnelStage.CONTACTED],
            ),
            contactedToResponded: conversionRate(
                stageCounts[FunnelStage.CONTACTED],
                stageCounts[FunnelStage.RESPONDED],
            ),
            respondedToMeetingBooked: conversionRate(
                stageCounts[FunnelStage.RESPONDED],
                stageCounts[FunnelStage.MEETING_BOOKED],
            ),
        },
        totalMembers: total,
    };
}
