/**
 * Onboarding funnel types shared across all Outpost apps and packages.
 */
export var FunnelStage;
(function (FunnelStage) {
    FunnelStage["JOINED"] = "JOINED";
    FunnelStage["CONTACTED"] = "CONTACTED";
    FunnelStage["RESPONDED"] = "RESPONDED";
    FunnelStage["MEETING_BOOKED"] = "MEETING_BOOKED";
})(FunnelStage || (FunnelStage = {}));
/** The ordered progression of funnel stages. */
export const FUNNEL_STAGE_ORDER = [
    FunnelStage.JOINED,
    FunnelStage.CONTACTED,
    FunnelStage.RESPONDED,
    FunnelStage.MEETING_BOOKED,
];
// DateRange is exported from ../sla/metrics.ts — use that one
