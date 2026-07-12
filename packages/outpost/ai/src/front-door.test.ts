import { describe, it, expect } from 'vitest';
import {
    FrontDoorCategory,
    FRONT_DOOR_CATEGORIES,
    isFrontDoorEligible,
    scoreTopIssue,
    rankTopIssues,
    type TopIssueInput,
} from './front-door.js';

// ─── Categories ───────────────────────────────────────────────────────────────

describe('front-door categories', () => {
    it('defines all six categories in skill order', () => {
        expect(FRONT_DOOR_CATEGORIES).toHaveLength(6);
        expect(FRONT_DOOR_CATEGORIES.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(FRONT_DOOR_CATEGORIES[0].id).toBe(FrontDoorCategory.QUICKSTART_BROKEN);
        expect(FRONT_DOOR_CATEGORIES[5].id).toBe(FrontDoorCategory.SEVERE_CRASH_DATA_LOSS);
    });

    it('treats every category as headline-eligible (P0)', () => {
        for (const meta of FRONT_DOOR_CATEGORIES) {
            expect(isFrontDoorEligible(meta.id)).toBe(true);
        }
    });
});

// ─── Per-axis scoring ─────────────────────────────────────────────────────────

const BASE: TopIssueInput = {
    id: 'base',
    surface: 'edge-config',
    blastRadius: 'narrow',
    severity: 'cosmetic',
    stillOpen: true,
};

describe('scoreTopIssue', () => {
    it('scores the surface tier', () => {
        expect(scoreTopIssue({ ...BASE, surface: 'install-quickstart-cli' }).surfaceScore).toBe(5);
        expect(scoreTopIssue({ ...BASE, surface: 'current-release-outage' }).surfaceScore).toBe(5);
        expect(scoreTopIssue({ ...BASE, surface: 'auth-security-blocker' }).surfaceScore).toBe(4);
        expect(scoreTopIssue({ ...BASE, surface: 'error-path-or-data-loss-crash' }).surfaceScore).toBe(4);
        expect(scoreTopIssue({ ...BASE, surface: 'core-feature-broken' }).surfaceScore).toBe(3);
        expect(scoreTopIssue({ ...BASE, surface: 'severe-crash' }).surfaceScore).toBe(3);
        expect(scoreTopIssue({ ...BASE, surface: 'docs-landing' }).surfaceScore).toBe(3);
        expect(scoreTopIssue({ ...BASE, surface: 'edge-config' }).surfaceScore).toBe(1);
    });

    it('scores blast radius and severity', () => {
        expect(scoreTopIssue({ ...BASE, blastRadius: 'default' }).blastScore).toBe(5);
        expect(scoreTopIssue({ ...BASE, blastRadius: 'large' }).blastScore).toBe(3);
        expect(scoreTopIssue({ ...BASE, blastRadius: 'narrow' }).blastScore).toBe(1);
        expect(scoreTopIssue({ ...BASE, severity: 'fully-broken' }).severityScore).toBe(3);
        expect(scoreTopIssue({ ...BASE, severity: 'workaround' }).severityScore).toBe(2);
        expect(scoreTopIssue({ ...BASE, severity: 'cosmetic' }).severityScore).toBe(1);
    });

    it('sums exposure flags additively', () => {
        expect(scoreTopIssue({ ...BASE, exposure: {} }).exposureScore).toBe(0);
        expect(
            scoreTopIssue({ ...BASE, exposure: { brokenOverOneMonth: true } }).exposureScore,
        ).toBe(2);
        expect(
            scoreTopIssue({ ...BASE, exposure: { shippedBrokenFixedSameDay: true } }).exposureScore,
        ).toBe(1);
        expect(
            scoreTopIssue({
                ...BASE,
                exposure: { brokenOverOneMonth: true, brokenOnCurrentRelease: true },
            }).exposureScore,
        ).toBe(4);
    });

    it('scores signal +1 for one factor, +2 for both', () => {
        expect(scoreTopIssue({ ...BASE, signal: {} }).signalScore).toBe(0);
        expect(
            scoreTopIssue({ ...BASE, signal: { enterpriseCurrentCompany: true } }).signalScore,
        ).toBe(1);
        expect(scoreTopIssue({ ...BASE, signal: { distinctReporters: 2 } }).signalScore).toBe(1);
        expect(scoreTopIssue({ ...BASE, signal: { distinctReporters: 1 } }).signalScore).toBe(0);
        expect(
            scoreTopIssue({
                ...BASE,
                signal: { enterpriseCurrentCompany: true, distinctReporters: 3 },
            }).signalScore,
        ).toBe(2);
    });

    it('totals all five axes', () => {
        const scored = scoreTopIssue({
            id: 'x',
            surface: 'install-quickstart-cli', // 5
            blastRadius: 'default', // 5
            severity: 'fully-broken', // 3
            exposure: { brokenOnCurrentRelease: true }, // 2
            signal: { enterpriseCurrentCompany: true, distinctReporters: 2 }, // 2
            stillOpen: true,
        });
        expect(scored.total).toBe(17);
    });
});

// ─── Ranking + tie-breaks ─────────────────────────────────────────────────────

describe('rankTopIssues', () => {
    it('sorts by total descending', () => {
        const ranked = rankTopIssues([
            { ...BASE, id: 'low' },
            {
                id: 'high',
                surface: 'install-quickstart-cli',
                blastRadius: 'default',
                severity: 'fully-broken',
                stillOpen: true,
            },
        ]);
        expect(ranked.map((r) => r.id)).toEqual(['high', 'low']);
    });

    it('breaks ties on blast radius first', () => {
        // Equal totals (12), different blast composition.
        const wideBlast: TopIssueInput = {
            id: 'wide',
            surface: 'core-feature-broken', // 3
            blastRadius: 'default', // 5
            severity: 'fully-broken', // 3
            exposure: { shippedBrokenFixedSameDay: true }, // 1
            stillOpen: true,
        };
        const narrowBlast: TopIssueInput = {
            id: 'narrow',
            surface: 'install-quickstart-cli', // 5
            blastRadius: 'large', // 3
            severity: 'fully-broken', // 3
            exposure: { shippedBrokenFixedSameDay: true }, // 1
            stillOpen: true,
        };
        const ranked = rankTopIssues([narrowBlast, wideBlast]);
        expect(ranked[0].total).toBe(ranked[1].total);
        expect(ranked[0].id).toBe('wide');
    });

    it('the open wound edges a same-day-fixed issue at an equal score', () => {
        const fixed: TopIssueInput = {
            id: 'fixed',
            surface: 'core-feature-broken',
            blastRadius: 'large',
            severity: 'fully-broken',
            stillOpen: false,
        };
        const open: TopIssueInput = {
            id: 'open',
            surface: 'core-feature-broken',
            blastRadius: 'large',
            severity: 'fully-broken',
            stillOpen: true,
        };
        const ranked = rankTopIssues([fixed, open]);
        expect(ranked[0].id).toBe('open');
    });
});
