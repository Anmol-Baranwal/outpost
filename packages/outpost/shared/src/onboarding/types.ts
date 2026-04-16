/**
 * Onboarding funnel types shared across all Outpost apps and packages.
 */

export enum FunnelStage {
    JOINED = 'JOINED',
    CONTACTED = 'CONTACTED',
    RESPONDED = 'RESPONDED',
    MEETING_BOOKED = 'MEETING_BOOKED',
}

/** The ordered progression of funnel stages. */
export const FUNNEL_STAGE_ORDER: FunnelStage[] = [
    FunnelStage.JOINED,
    FunnelStage.CONTACTED,
    FunnelStage.RESPONDED,
    FunnelStage.MEETING_BOOKED,
];

export interface OnboardingMember {
    id: string;
    discordId: string;
    username: string;
    joinedAt: Date | string;
    funnelStage: FunnelStage;
    contacted: boolean;
    responded: boolean;
    meetingBooked: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
}

export interface FunnelMetrics {
    /** Count of members at each stage. */
    stageCounts: Record<FunnelStage, number>;
    /** Conversion rate from one stage to the next (percentage 0-100). */
    conversionRates: {
        joinedToContacted: number;
        contactedToResponded: number;
        respondedToMeetingBooked: number;
    };
    /** Total members in the date range. */
    totalMembers: number;
}

// DateRange is exported from ../sla/metrics.ts — use that one
