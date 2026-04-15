/**
 * Mock agent data for development.
 * In production these come from the database via Prisma.
 */

export type AgentTriggerType = 'interval' | 'cron' | 'manual';
export type AgentActionType =
    | 'classify_tickets'
    | 'check_sla'
    | 'generate_faq'
    | 'custom_webhook';

export type AgentStatus = 'ACTIVE' | 'PAUSED' | 'ERROR';

export interface AgentConfig {
    triggerType: AgentTriggerType;
    /** Interval in minutes, relevant when triggerType is 'interval' */
    intervalMinutes?: number;
    /** Cron expression, relevant when triggerType is 'cron' */
    cronExpression?: string;
    actionType: AgentActionType;
    /** Webhook URL for custom_webhook action type */
    webhookUrl?: string;
}

export interface MockAgent {
    id: string;
    name: string;
    description: string | null;
    config: AgentConfig;
    lastRun: string | null;
    status: AgentStatus;
    createdAt: string;
    updatedAt: string;
}

export const ACTION_TYPE_LABELS: Record<AgentActionType, string> = {
    classify_tickets: 'Run AI classification on unclassified tickets',
    check_sla: 'Check SLA compliance',
    generate_faq: 'Generate FAQ from recent tickets',
    custom_webhook: 'Custom webhook',
};

export const TRIGGER_TYPE_LABELS: Record<AgentTriggerType, string> = {
    interval: 'Interval',
    cron: 'Cron',
    manual: 'Manual',
};

export const MOCK_AGENTS: MockAgent[] = [
    {
        id: 'agent-1',
        name: 'Auto-Classifier',
        description: 'Runs AI classification on unclassified tickets every 15 minutes.',
        config: {
            triggerType: 'interval',
            intervalMinutes: 15,
            actionType: 'classify_tickets',
        },
        lastRun: '2026-04-15T08:30:00Z',
        status: 'ACTIVE',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-04-15T08:30:00Z',
    },
    {
        id: 'agent-2',
        name: 'SLA Watchdog',
        description: 'Checks SLA compliance on a cron schedule and alerts the team on breaches.',
        config: {
            triggerType: 'cron',
            cronExpression: '0 */6 * * *',
            actionType: 'check_sla',
        },
        lastRun: '2026-04-15T06:00:00Z',
        status: 'ACTIVE',
        createdAt: '2026-03-05T14:00:00Z',
        updatedAt: '2026-04-15T06:00:00Z',
    },
    {
        id: 'agent-3',
        name: 'FAQ Generator',
        description: 'Generates FAQ entries from recent ticket patterns every night at midnight.',
        config: {
            triggerType: 'cron',
            cronExpression: '0 0 * * *',
            actionType: 'generate_faq',
        },
        lastRun: '2026-04-15T00:00:00Z',
        status: 'PAUSED',
        createdAt: '2026-03-10T09:00:00Z',
        updatedAt: '2026-04-14T12:00:00Z',
    },
    {
        id: 'agent-4',
        name: 'Escalation Notifier',
        description: 'Calls an external webhook when high-priority tickets are detected.',
        config: {
            triggerType: 'manual',
            actionType: 'custom_webhook',
            webhookUrl: 'https://hooks.example.com/escalation',
        },
        lastRun: null,
        status: 'ERROR',
        createdAt: '2026-04-01T16:00:00Z',
        updatedAt: '2026-04-12T10:30:00Z',
    },
];

export function findMockAgent(id: string): MockAgent | undefined {
    return MOCK_AGENTS.find((a) => a.id === id);
}

export function filterMockAgents(search?: string): MockAgent[] {
    if (!search) return MOCK_AGENTS;
    const term = search.toLowerCase();
    return MOCK_AGENTS.filter(
        (a) =>
            a.name.toLowerCase().includes(term) ||
            (a.description && a.description.toLowerCase().includes(term)),
    );
}
