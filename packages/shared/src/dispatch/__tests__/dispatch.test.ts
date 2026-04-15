/**
 * Tests for the dispatch routing engine, matcher, and on-call rotation.
 *
 * Developed with red-green discipline: tests written first, then verified
 * against the implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TeamMemberRole } from '../../types.js';
import { evaluateRouting } from '../engine.js';
import { matchCondition } from '../matcher.js';
import {
    getCurrentOnCall,
    peekOnCall,
    getOnCallMembers,
    resetRotation,
} from '../on-call.js';
import { DEFAULT_ROUTING_RULES } from '../default-rules.js';
import type {
    RoutingTicket,
    RoutingTeamMember,
    RoutingRule,
    KeywordCondition,
    SourceCondition,
    AcvCondition,
    TicketTypeCondition,
} from '../types.js';

// ─── Test Fixtures ─────────────────────────────────────────────────────────

const teamMembers: RoutingTeamMember[] = [
    { id: 'admin-1', name: 'Alice Admin', role: TeamMemberRole.ADMIN },
    { id: 'eng-1', name: 'Bob Engineer', role: TeamMemberRole.ENGINEER },
    { id: 'support-1', name: 'Carol Support', role: TeamMemberRole.SUPPORT },
    { id: 'eng-2', name: 'Dave Engineer', role: TeamMemberRole.ENGINEER },
];

function makeTicket(overrides: Partial<RoutingTicket> = {}): RoutingTicket {
    return {
        id: 'tkt-test-1',
        title: 'Test ticket',
        description: 'A test ticket for routing',
        source: 'DISCORD',
        type: 'QUESTION',
        priority: 'MEDIUM',
        account: null,
        assigneeId: null,
        ...overrides,
    };
}

// ─── Matcher Tests ─────────────────────────────────────────────────────────

describe('matchCondition', () => {
    describe('keyword matching', () => {
        it('matches billing keywords in ticket title', () => {
            const condition: KeywordCondition = {
                type: 'keyword',
                keywords: ['billing', 'invoice', 'payment'],
            };
            const ticket = makeTicket({ title: 'Billing issue with my account' });
            const confidence = matchCondition(condition, ticket);
            expect(confidence).toBeGreaterThan(0);
        });

        it('matches billing keywords in ticket description', () => {
            const condition: KeywordCondition = {
                type: 'keyword',
                keywords: ['billing', 'invoice', 'payment'],
            };
            const ticket = makeTicket({
                title: 'Help needed',
                description: 'I have a billing question about my invoice',
            });
            const confidence = matchCondition(condition, ticket);
            expect(confidence).toBeGreaterThan(0);
        });

        it('returns 0 when no keywords match', () => {
            const condition: KeywordCondition = {
                type: 'keyword',
                keywords: ['billing', 'invoice'],
            };
            const ticket = makeTicket({
                title: 'How to use CopilotKit',
                description: 'I need help with the SDK',
            });
            const confidence = matchCondition(condition, ticket);
            expect(confidence).toBe(0);
        });

        it('is case-insensitive', () => {
            const condition: KeywordCondition = {
                type: 'keyword',
                keywords: ['BILLING'],
            };
            const ticket = makeTicket({ title: 'billing question' });
            expect(matchCondition(condition, ticket)).toBeGreaterThan(0);
        });

        it('returns higher confidence for multiple keyword matches', () => {
            const condition: KeywordCondition = {
                type: 'keyword',
                keywords: ['billing', 'invoice', 'payment', 'subscription'],
            };
            const singleMatch = makeTicket({ title: 'billing issue' });
            const multiMatch = makeTicket({ title: 'billing and invoice for subscription' });

            const singleConfidence = matchCondition(condition, singleMatch);
            const multiConfidence = matchCondition(condition, multiMatch);

            expect(multiConfidence).toBeGreaterThan(singleConfidence);
        });

        it('respects field restriction to title only', () => {
            const condition: KeywordCondition = {
                type: 'keyword',
                keywords: ['billing'],
                field: 'title',
            };
            const titleMatch = makeTicket({ title: 'billing issue', description: 'no match here' });
            const descMatch = makeTicket({ title: 'help needed', description: 'billing question' });

            expect(matchCondition(condition, titleMatch)).toBeGreaterThan(0);
            expect(matchCondition(condition, descMatch)).toBe(0);
        });
    });

    describe('source matching', () => {
        it('matches GitHub sources', () => {
            const condition: SourceCondition = {
                type: 'source',
                sources: ['GITHUB_ISSUE', 'GITHUB_DISCUSSION'],
            };
            const ticket = makeTicket({ source: 'GITHUB_ISSUE' });
            expect(matchCondition(condition, ticket)).toBeGreaterThan(0);
        });

        it('returns 0 for non-matching source', () => {
            const condition: SourceCondition = {
                type: 'source',
                sources: ['GITHUB_ISSUE'],
            };
            const ticket = makeTicket({ source: 'DISCORD' });
            expect(matchCondition(condition, ticket)).toBe(0);
        });

        it('is case-insensitive', () => {
            const condition: SourceCondition = {
                type: 'source',
                sources: ['github_issue'],
            };
            const ticket = makeTicket({ source: 'GITHUB_ISSUE' });
            expect(matchCondition(condition, ticket)).toBeGreaterThan(0);
        });
    });

    describe('ACV matching', () => {
        it('matches accounts above threshold', () => {
            const condition: AcvCondition = {
                type: 'acv',
                minAcv: 50_000,
            };
            const ticket = makeTicket({
                account: { id: 'acct-1', acv: 75_000, owner: null },
            });
            expect(matchCondition(condition, ticket)).toBeGreaterThan(0);
        });

        it('returns 0 for accounts below threshold', () => {
            const condition: AcvCondition = {
                type: 'acv',
                minAcv: 50_000,
            };
            const ticket = makeTicket({
                account: { id: 'acct-1', acv: 30_000, owner: null },
            });
            expect(matchCondition(condition, ticket)).toBe(0);
        });

        it('returns 0 when no account is present', () => {
            const condition: AcvCondition = {
                type: 'acv',
                minAcv: 50_000,
            };
            const ticket = makeTicket({ account: null });
            expect(matchCondition(condition, ticket)).toBe(0);
        });

        it('returns 0 when ACV is null', () => {
            const condition: AcvCondition = {
                type: 'acv',
                minAcv: 50_000,
            };
            const ticket = makeTicket({
                account: { id: 'acct-1', acv: null, owner: null },
            });
            expect(matchCondition(condition, ticket)).toBe(0);
        });

        it('returns higher confidence for much higher ACV', () => {
            const condition: AcvCondition = {
                type: 'acv',
                minAcv: 50_000,
            };
            const justAbove = makeTicket({
                account: { id: 'acct-1', acv: 51_000, owner: null },
            });
            const wellAbove = makeTicket({
                account: { id: 'acct-2', acv: 200_000, owner: null },
            });

            const lowConf = matchCondition(condition, justAbove);
            const highConf = matchCondition(condition, wellAbove);
            expect(highConf).toBeGreaterThan(lowConf);
        });
    });

    describe('ticket type matching', () => {
        it('matches BUG ticket type', () => {
            const condition: TicketTypeCondition = {
                type: 'ticketType',
                ticketTypes: ['BUG'],
            };
            const ticket = makeTicket({ type: 'BUG' });
            expect(matchCondition(condition, ticket)).toBeGreaterThan(0);
        });

        it('returns 0 for non-matching type', () => {
            const condition: TicketTypeCondition = {
                type: 'ticketType',
                ticketTypes: ['BUG'],
            };
            const ticket = makeTicket({ type: 'FEATURE_REQUEST' });
            expect(matchCondition(condition, ticket)).toBe(0);
        });
    });
});

// ─── Routing Engine Tests ──────────────────────────────────────────────────

describe('evaluateRouting', () => {
    it('routes billing keywords to admin/sales team', () => {
        const ticket = makeTicket({
            title: 'Billing question about our subscription',
            description: 'We need to update our payment method',
        });

        const result = evaluateRouting(ticket, teamMembers);

        expect(result.matchedRule).not.toBeNull();
        expect(result.matchedRule!.name).toBe('billing-to-sales');
        expect(result.targetMemberId).toBe('admin-1');
        expect(result.confidence).toBeGreaterThan(0);
    });

    it('routes high-ACV accounts to account owner', () => {
        const ticket = makeTicket({
            title: 'Need help with integration',
            description: 'Having trouble setting up CopilotKit',
            account: { id: 'acct-big', acv: 100_000, owner: 'Alice Admin' },
        });

        const result = evaluateRouting(ticket, teamMembers);

        expect(result.matchedRule).not.toBeNull();
        expect(result.matchedRule!.name).toBe('high-acv-account-owner');
        expect(result.targetMemberId).toBe('admin-1'); // Alice Admin
    });

    it('routes GitHub source tickets to engineering', () => {
        const ticket = makeTicket({
            source: 'GITHUB_ISSUE',
            title: 'Feature request for better docs',
            description: 'The documentation could be improved',
        });

        const result = evaluateRouting(ticket, teamMembers);

        expect(result.matchedRule).not.toBeNull();
        expect(result.matchedRule!.name).toBe('github-to-engineering');
        expect(result.targetMemberId).toBe('eng-1');
    });

    it('routes agent topics to engineering specialist', () => {
        const ticket = makeTicket({
            title: 'CoAgent not working',
            description: 'My CoAgent integration throws errors',
        });

        const result = evaluateRouting(ticket, teamMembers);

        expect(result.matchedRule).not.toBeNull();
        expect(result.matchedRule!.name).toBe('agent-topics-to-specialist');
        expect(result.targetMemberId).toBe('eng-1');
    });

    it('falls back to on-call when no rule matches', () => {
        const ticket = makeTicket({
            title: 'Generic question',
            description: 'Nothing specific about this ticket',
            source: 'WEB',
            type: 'OTHER',
        });

        const onCallMembers = ['oncall-1', 'oncall-2'];
        resetRotation();

        const result = evaluateRouting(ticket, teamMembers, undefined, onCallMembers);

        expect(result.matchedRule).toBeNull();
        expect(result.targetMemberId).toBe('oncall-1');
        expect(result.confidence).toBe(0.3);
        expect(result.reason).toContain('on-call');
    });

    it('returns null target when no rules match and no on-call configured', () => {
        const ticket = makeTicket({
            title: 'Generic question',
            description: 'Nothing matches',
            source: 'WEB',
            type: 'OTHER',
        });

        const result = evaluateRouting(ticket, teamMembers, undefined, []);

        expect(result.matchedRule).toBeNull();
        expect(result.targetMemberId).toBeNull();
    });

    it('respects rule priority ordering', () => {
        // A billing ticket from a high-ACV account should match ACV first (priority 10)
        // before billing (priority 20)
        const ticket = makeTicket({
            title: 'Billing issue',
            description: 'Need to update payment',
            account: { id: 'acct-big', acv: 100_000, owner: 'Alice Admin' },
        });

        const result = evaluateRouting(ticket, teamMembers);

        // ACV rule has priority 10, billing has priority 20
        expect(result.matchedRule!.name).toBe('high-acv-account-owner');
    });

    it('skips disabled rules', () => {
        const customRules: RoutingRule[] = [
            {
                name: 'disabled-rule',
                description: 'This rule is disabled',
                condition: { type: 'keyword', keywords: ['billing'] },
                targetRole: TeamMemberRole.ADMIN,
                priority: 1,
                enabled: false,
            },
            {
                name: 'enabled-rule',
                description: 'This rule is enabled',
                condition: { type: 'keyword', keywords: ['billing'] },
                targetRole: TeamMemberRole.ENGINEER,
                priority: 2,
                enabled: true,
            },
        ];

        const ticket = makeTicket({ title: 'Billing question' });
        const result = evaluateRouting(ticket, teamMembers, customRules, []);

        expect(result.matchedRule!.name).toBe('enabled-rule');
        expect(result.targetMemberId).toBe('eng-1');
    });

    it('uses targetMemberId when set directly on rule', () => {
        const customRules: RoutingRule[] = [
            {
                name: 'direct-assign',
                description: 'Directly assign to specific member',
                condition: { type: 'keyword', keywords: ['vip'] },
                targetMemberId: 'eng-2',
                priority: 1,
                enabled: true,
            },
        ];

        const ticket = makeTicket({ title: 'VIP customer needs help' });
        const result = evaluateRouting(ticket, teamMembers, customRules, []);

        expect(result.targetMemberId).toBe('eng-2');
    });
});

// ─── On-Call Rotation Tests ────────────────────────────────────────────────

describe('on-call rotation', () => {
    beforeEach(() => {
        resetRotation();
    });

    it('cycles through members in round-robin order', () => {
        const members = ['m1', 'm2', 'm3'];

        expect(getCurrentOnCall(members)).toBe('m1');
        expect(getCurrentOnCall(members)).toBe('m2');
        expect(getCurrentOnCall(members)).toBe('m3');
        expect(getCurrentOnCall(members)).toBe('m1'); // wraps around
    });

    it('returns null when no members configured', () => {
        expect(getCurrentOnCall([])).toBeNull();
    });

    it('handles single member', () => {
        const members = ['solo'];

        expect(getCurrentOnCall(members)).toBe('solo');
        expect(getCurrentOnCall(members)).toBe('solo');
    });

    it('peekOnCall does not advance rotation', () => {
        const members = ['m1', 'm2', 'm3'];

        expect(peekOnCall(members)).toBe('m1');
        expect(peekOnCall(members)).toBe('m1'); // still m1
        expect(getCurrentOnCall(members)).toBe('m1'); // now advances
        expect(peekOnCall(members)).toBe('m2'); // next one
    });

    it('parses comma-separated env var', () => {
        const members = getOnCallMembers('  alice , bob , charlie  ');
        expect(members).toEqual(['alice', 'bob', 'charlie']);
    });

    it('handles empty env var', () => {
        const members = getOnCallMembers('');
        expect(members).toEqual([]);
    });

    it('resetRotation resets to first member', () => {
        const members = ['m1', 'm2', 'm3'];

        getCurrentOnCall(members); // m1
        getCurrentOnCall(members); // m2

        resetRotation();

        expect(getCurrentOnCall(members)).toBe('m1');
    });
});

// ─── Default Rules Tests ───────────────────────────────────────────────────

describe('default routing rules', () => {
    it('has expected number of default rules', () => {
        expect(DEFAULT_ROUTING_RULES.length).toBeGreaterThanOrEqual(5);
    });

    it('all default rules are enabled', () => {
        for (const rule of DEFAULT_ROUTING_RULES) {
            expect(rule.enabled).toBe(true);
        }
    });

    it('rules have unique names', () => {
        const names = DEFAULT_ROUTING_RULES.map((r) => r.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
    });

    it('rules have unique priorities', () => {
        const priorities = DEFAULT_ROUTING_RULES.map((r) => r.priority);
        const uniquePriorities = new Set(priorities);
        expect(uniquePriorities.size).toBe(priorities.length);
    });

    it('rules are sorted by priority in the array', () => {
        for (let i = 1; i < DEFAULT_ROUTING_RULES.length; i++) {
            expect(DEFAULT_ROUTING_RULES[i].priority).toBeGreaterThan(
                DEFAULT_ROUTING_RULES[i - 1].priority,
            );
        }
    });
});
