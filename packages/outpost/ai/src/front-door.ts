/**
 * Front-door triage — deterministic classification + Top-issue ranking.
 *
 * Ports the `front-door-triage` Claude Code skill into native TS (issue #66).
 * Two pieces, both deterministic so the report's lead section is auditable
 * rather than asserted:
 *
 *   1. The six P0 front-door categories (every one auto-headlines — 1 report
 *      is enough, the demand/pain threshold is skipped).
 *   2. The Top-issue ranking rubric — score each candidate on five axes, sum,
 *      and sort descending with a defined tie-break order.
 *
 * The skill is the source of truth for the rules; keep this in sync with
 * `.claude/skills/front-door-triage/SKILL.md`.
 */

// ─── Six front-door categories ────────────────────────────────────────────────

export enum FrontDoorCategory {
    QUICKSTART_BROKEN = 'QUICKSTART_BROKEN',
    AGENT_FRAMEWORK_INTEGRATION_BROKEN = 'AGENT_FRAMEWORK_INTEGRATION_BROKEN',
    EXAMPLE_CODE_BROKEN = 'EXAMPLE_CODE_BROKEN',
    AUTH_SECURITY_BLOCKER = 'AUTH_SECURITY_BLOCKER',
    CLI_LICENSE_LOGIN_BROKEN = 'CLI_LICENSE_LOGIN_BROKEN',
    SEVERE_CRASH_DATA_LOSS = 'SEVERE_CRASH_DATA_LOSS',
}

export interface FrontDoorCategoryMeta {
    id: FrontDoorCategory;
    /** 1-based number used in the skill + report headings. */
    number: number;
    emoji: string;
    title: string;
}

/** Category metadata, in skill order. All six are P0 / headline-eligible. */
export const FRONT_DOOR_CATEGORIES: readonly FrontDoorCategoryMeta[] = [
    { id: FrontDoorCategory.QUICKSTART_BROKEN, number: 1, emoji: '🚨', title: 'Quickstart broken' },
    {
        id: FrontDoorCategory.AGENT_FRAMEWORK_INTEGRATION_BROKEN,
        number: 2,
        emoji: '🚨',
        title: 'Agent framework integration broken',
    },
    { id: FrontDoorCategory.EXAMPLE_CODE_BROKEN, number: 3, emoji: '🚨', title: 'Example code broken' },
    {
        id: FrontDoorCategory.AUTH_SECURITY_BLOCKER,
        number: 4,
        emoji: '🚨',
        title: 'Auth / security blocker on runtime surface',
    },
    {
        id: FrontDoorCategory.CLI_LICENSE_LOGIN_BROKEN,
        number: 5,
        emoji: '🚨',
        title: 'CLI + license/login flow broken',
    },
    {
        id: FrontDoorCategory.SEVERE_CRASH_DATA_LOSS,
        number: 6,
        emoji: '🚨',
        title: 'Severe crash / data-loss / error-handling break',
    },
] as const;

/**
 * Every front-door category is P0: a single report headlines, regardless of
 * the demand/pain threshold that gates ordinary signals.
 */
export function isFrontDoorEligible(category: FrontDoorCategory): boolean {
    return FRONT_DOOR_CATEGORIES.some((c) => c.id === category);
}

// ─── Top-issue ranking rubric ─────────────────────────────────────────────────

/** Where in the funnel the issue sits. */
export type SurfaceTier =
    | 'install-quickstart-cli' // install/quickstart CLI
    | 'current-release-outage' // current-release outage
    | 'auth-security-blocker'
    | 'error-path-or-data-loss-crash'
    | 'core-feature-broken'
    | 'severe-crash' // category 6
    | 'docs-landing'
    | 'edge-config';

/** Who actually hits it. */
export type BlastRadius = 'default' | 'large' | 'narrow';

/** Is there a workaround. */
export type Severity = 'fully-broken' | 'workaround' | 'cosmetic';

/** Additive exposure flags — duration / how it shipped. */
export interface ExposureFlags {
    brokenOverOneMonth?: boolean;
    brokenOnCurrentRelease?: boolean;
    shippedBrokenFixedSameDay?: boolean;
}

/** Who's reporting. */
export interface SignalInput {
    enterpriseCurrentCompany?: boolean;
    distinctReporters?: number;
}

export interface TopIssueInput {
    /** Candidate identifier (issue ref / Discord thread id). */
    id: string;
    surface: SurfaceTier;
    blastRadius: BlastRadius;
    severity: Severity;
    exposure?: ExposureFlags;
    signal?: SignalInput;
    /**
     * Whether the issue is still open. Tie-break favours the open wound over a
     * same-day-fixed one at an equal score.
     */
    stillOpen: boolean;
}

export interface ScoredTopIssue extends TopIssueInput {
    surfaceScore: number;
    blastScore: number;
    severityScore: number;
    exposureScore: number;
    signalScore: number;
    total: number;
}

const SURFACE_SCORES: Record<SurfaceTier, number> = {
    'install-quickstart-cli': 5,
    'current-release-outage': 5,
    'auth-security-blocker': 4,
    'error-path-or-data-loss-crash': 4,
    'core-feature-broken': 3,
    'severe-crash': 3,
    'docs-landing': 3,
    'edge-config': 1,
};

const BLAST_SCORES: Record<BlastRadius, number> = {
    default: 5,
    large: 3,
    narrow: 1,
};

const SEVERITY_SCORES: Record<Severity, number> = {
    'fully-broken': 3,
    workaround: 2,
    cosmetic: 1,
};

function exposureScore(flags: ExposureFlags = {}): number {
    let score = 0;
    if (flags.brokenOverOneMonth) score += 2;
    if (flags.brokenOnCurrentRelease) score += 2;
    if (flags.shippedBrokenFixedSameDay) score += 1;
    return score;
}

/**
 * Signal axis: "+1–2". Enterprise current-company OR ≥2 distinct reporters
 * scores +1; satisfying BOTH scores +2.
 */
function signalScore(signal: SignalInput = {}): number {
    const enterprise = signal.enterpriseCurrentCompany === true;
    const multiReporter = (signal.distinctReporters ?? 0) >= 2;
    return (enterprise ? 1 : 0) + (multiReporter ? 1 : 0);
}

/** Score a single Top-issue candidate across all five axes. */
export function scoreTopIssue(input: TopIssueInput): ScoredTopIssue {
    const surfaceScore = SURFACE_SCORES[input.surface];
    const blastScore = BLAST_SCORES[input.blastRadius];
    const severityScore = SEVERITY_SCORES[input.severity];
    const expScore = exposureScore(input.exposure);
    const sigScore = signalScore(input.signal);

    return {
        ...input,
        surfaceScore,
        blastScore,
        severityScore,
        exposureScore: expScore,
        signalScore: sigScore,
        total: surfaceScore + blastScore + severityScore + expScore + sigScore,
    };
}

/**
 * Rank candidates: score each, sort by total descending. Tie-break order
 * (per the skill): blast radius → still-open-before-resolved → surface tier.
 * Stable for fully-equal candidates (preserves input order).
 */
export function rankTopIssues(inputs: TopIssueInput[]): ScoredTopIssue[] {
    return inputs
        .map(scoreTopIssue)
        .sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            if (b.blastScore !== a.blastScore) return b.blastScore - a.blastScore;
            // Still-broken edges a same-day-fixed one — the open wound wins.
            if (a.stillOpen !== b.stillOpen) return a.stillOpen ? -1 : 1;
            return b.surfaceScore - a.surfaceScore;
        });
}
