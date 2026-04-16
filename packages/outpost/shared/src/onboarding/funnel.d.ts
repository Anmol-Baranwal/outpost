/**
 * Conversion funnel tracking logic for community onboarding.
 *
 * Pure functions that compute funnel stage transitions and metrics.
 * Database interactions are left to the caller.
 */
import { FunnelStage } from './types.js';
import type { OnboardingMember, FunnelMetrics } from './types.js';
/**
 * Determine the boolean flags that should be set for a given funnel stage.
 * Each stage implies all previous stages are also true.
 */
export declare function flagsForStage(stage: FunnelStage): {
    contacted: boolean;
    responded: boolean;
    meetingBooked: boolean;
};
/**
 * Validate that a stage transition is valid (can only move forward).
 * Returns true if newStage is ahead of or equal to currentStage.
 */
export declare function isValidTransition(currentStage: FunnelStage, newStage: FunnelStage): boolean;
/**
 * Compute conversion funnel metrics from a list of onboarding members.
 */
export declare function computeFunnelMetrics(members: OnboardingMember[]): FunnelMetrics;
//# sourceMappingURL=funnel.d.ts.map