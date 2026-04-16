/**
 * Default routing rules for the dispatch engine.
 *
 * These are the built-in rules that ship with Outpost. They can be
 * overridden or extended by adding custom rules with higher/lower priority.
 */
import { TeamMemberRole } from '../types.js';
export const DEFAULT_ROUTING_RULES = [
    {
        name: 'high-acv-account-owner',
        description: 'Route tickets from high-ACV accounts (>$50K) to account owner, falling back to admin role',
        condition: {
            type: 'acv',
            minAcv: 50_000,
        },
        // targetMemberId is resolved dynamically from account.owner
        targetRole: TeamMemberRole.ADMIN,
        priority: 10,
        enabled: true,
    },
    {
        name: 'billing-to-sales',
        description: 'Route billing/payment/invoice keywords to admin team',
        condition: {
            type: 'keyword',
            keywords: [
                'billing',
                'invoice',
                'payment',
                'subscription',
                'pricing',
                'refund',
                'charge',
                'plan',
                'upgrade',
                'downgrade',
                'cancel subscription',
                'renewal',
            ],
        },
        targetRole: TeamMemberRole.ADMIN,
        priority: 20,
        enabled: true,
    },
    {
        name: 'agent-topics-to-specialist',
        description: 'Route CoAgent/agent-related topics to agent specialists',
        condition: {
            type: 'keyword',
            keywords: [
                'coagent',
                'co-agent',
                'agent',
                'langchain',
                'langgraph',
                'crewai',
                'autogen',
                'agent protocol',
                'ag-ui',
                'agent-ui',
                'copilotkit agent',
            ],
        },
        targetRole: TeamMemberRole.ENGINEER,
        priority: 30,
        enabled: true,
    },
    {
        name: 'github-to-engineering',
        description: 'Route GitHub-sourced tickets to engineering on-call',
        condition: {
            type: 'source',
            sources: ['GITHUB_ISSUE', 'GITHUB_DISCUSSION'],
        },
        targetRole: TeamMemberRole.ENGINEER,
        priority: 40,
        enabled: true,
    },
    {
        name: 'bug-to-engineering',
        description: 'Route bug reports to engineering',
        condition: {
            type: 'ticketType',
            ticketTypes: ['BUG'],
        },
        targetRole: TeamMemberRole.ENGINEER,
        priority: 50,
        enabled: true,
    },
    {
        name: 'account-issues-to-support',
        description: 'Route account issues to support team',
        condition: {
            type: 'ticketType',
            ticketTypes: ['ACCOUNT_ISSUE'],
        },
        targetRole: TeamMemberRole.SUPPORT,
        priority: 60,
        enabled: true,
    },
];
