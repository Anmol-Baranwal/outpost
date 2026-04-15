import { describe, it, expect } from 'vitest';
import {
    MOCK_AGENTS,
    filterMockAgents,
    findMockAgent,
} from '@/lib/mock-agents';
import type { AgentFormData } from '@/components/agents/agent-form';
import { validateAgentForm } from '@/components/agents/agent-form';

describe('Agent mock data and helpers', () => {
    describe('MOCK_AGENTS', () => {
        it('has 4 agents with different statuses', () => {
            expect(MOCK_AGENTS).toHaveLength(4);
            const statuses = MOCK_AGENTS.map((a) => a.status);
            expect(statuses).toContain('ACTIVE');
            expect(statuses).toContain('PAUSED');
            expect(statuses).toContain('ERROR');
        });

        it('each agent has required fields', () => {
            for (const agent of MOCK_AGENTS) {
                expect(agent.id).toBeTruthy();
                expect(agent.name).toBeTruthy();
                expect(agent.config).toBeDefined();
                expect(agent.config.triggerType).toBeTruthy();
                expect(agent.config.actionType).toBeTruthy();
                expect(agent.status).toBeTruthy();
                expect(agent.createdAt).toBeTruthy();
                expect(agent.updatedAt).toBeTruthy();
            }
        });
    });

    describe('findMockAgent', () => {
        it('finds an agent by ID', () => {
            const agent = findMockAgent('agent-1');
            expect(agent).toBeDefined();
            expect(agent?.name).toBe('Auto-Classifier');
        });

        it('returns undefined for non-existent ID', () => {
            expect(findMockAgent('nonexistent')).toBeUndefined();
        });
    });

    describe('filterMockAgents', () => {
        it('returns all agents when no search term', () => {
            expect(filterMockAgents()).toHaveLength(MOCK_AGENTS.length);
            expect(filterMockAgents('')).toHaveLength(MOCK_AGENTS.length);
        });

        it('filters by agent name', () => {
            const result = filterMockAgents('Classifier');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Auto-Classifier');
        });

        it('filters by description', () => {
            const result = filterMockAgents('webhook');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Escalation Notifier');
        });

        it('is case-insensitive', () => {
            const result = filterMockAgents('sla');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('SLA Watchdog');
        });

        it('returns empty for no matches', () => {
            expect(filterMockAgents('zzzznonexistent')).toHaveLength(0);
        });
    });
});

describe('Agent form validation', () => {
    const validData: AgentFormData = {
        name: 'Test Agent',
        description: 'A test agent',
        config: {
            triggerType: 'manual',
            actionType: 'classify_tickets',
        },
    };

    it('passes for valid manual trigger data', () => {
        const errors = validateAgentForm(validData);
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('fails when name is empty', () => {
        const errors = validateAgentForm({ ...validData, name: '' });
        expect(errors.name).toBe('Name is required');
    });

    it('fails when name is whitespace only', () => {
        const errors = validateAgentForm({ ...validData, name: '   ' });
        expect(errors.name).toBe('Name is required');
    });

    it('fails when interval is missing for interval trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'interval', actionType: 'classify_tickets', intervalMinutes: 0 },
        });
        expect(errors.intervalMinutes).toBeTruthy();
    });

    it('fails when cron expression is empty for cron trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'cron', actionType: 'classify_tickets', cronExpression: '' },
        });
        expect(errors.cronExpression).toBeTruthy();
    });

    it('fails when webhook URL is missing for custom_webhook action', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'manual', actionType: 'custom_webhook' },
        });
        expect(errors.webhookUrl).toBeTruthy();
    });

    it('fails when webhook URL is not valid', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'manual', actionType: 'custom_webhook', webhookUrl: 'not-a-url' },
        });
        expect(errors.webhookUrl).toBe('Must be a valid URL');
    });

    it('passes when webhook URL is valid', () => {
        const errors = validateAgentForm({
            ...validData,
            config: {
                triggerType: 'manual',
                actionType: 'custom_webhook',
                webhookUrl: 'https://hooks.example.com/test',
            },
        });
        expect(errors.webhookUrl).toBeUndefined();
    });

    it('passes for valid interval trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'interval', actionType: 'classify_tickets', intervalMinutes: 15 },
        });
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('passes for valid cron trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'cron', actionType: 'check_sla', cronExpression: '0 * * * *' },
        });
        expect(Object.keys(errors)).toHaveLength(0);
    });
});
