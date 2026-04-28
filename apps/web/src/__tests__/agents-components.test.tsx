import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentStatusBadge } from '@/components/agents/agent-status-badge';
import { AgentActions } from '@/components/agents/agent-actions';
import { AgentTable } from '@/components/agents/agent-table';
import type { Agent } from '@/components/agents/agent-table';
import { AgentForm } from '@/components/agents/agent-form';
import { MOCK_AGENTS } from '@/lib/mock-agents';

// Cast mock data to match the API-based Agent type (config is Record<string, unknown>)
const TEST_AGENTS = MOCK_AGENTS as unknown as Agent[];

// Mock next/navigation
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useParams: () => ({ id: 'agent-1' }),
}));

describe('AgentStatusBadge', () => {
    it('renders Active for ACTIVE status', () => {
        render(<AgentStatusBadge status="ACTIVE" />);
        expect(screen.getByText('Active')).toBeTruthy();
    });

    it('renders Inactive for PAUSED status', () => {
        render(<AgentStatusBadge status="PAUSED" />);
        expect(screen.getByText('Inactive')).toBeTruthy();
    });

    it('renders Error for ERROR status', () => {
        render(<AgentStatusBadge status="ERROR" />);
        expect(screen.getByText('Error')).toBeTruthy();
    });

    it('applies green styling for ACTIVE', () => {
        render(<AgentStatusBadge status="ACTIVE" />);
        const badge = screen.getByTestId('agent-status-badge');
        expect(badge.className).toContain('text-green-400');
    });

    it('applies red styling for ERROR', () => {
        render(<AgentStatusBadge status="ERROR" />);
        const badge = screen.getByTestId('agent-status-badge');
        expect(badge.className).toContain('text-red-400');
    });
});

describe('AgentActions', () => {
    it('renders run, edit, and delete buttons', () => {
        render(
            <AgentActions
                agentId="agent-1"
                onRun={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        expect(screen.getByTestId('agent-run-btn')).toBeTruthy();
        expect(screen.getByTestId('agent-edit-btn')).toBeTruthy();
        expect(screen.getByTestId('agent-delete-btn')).toBeTruthy();
    });

    it('calls onRun with agent ID when run button clicked', () => {
        const onRun = vi.fn();
        render(
            <AgentActions
                agentId="agent-1"
                onRun={onRun}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId('agent-run-btn'));
        expect(onRun).toHaveBeenCalledWith('agent-1');
    });

    it('calls onEdit with agent ID when edit button clicked', () => {
        const onEdit = vi.fn();
        render(
            <AgentActions
                agentId="agent-1"
                onRun={vi.fn()}
                onEdit={onEdit}
                onDelete={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId('agent-edit-btn'));
        expect(onEdit).toHaveBeenCalledWith('agent-1');
    });

    it('calls onDelete with agent ID when delete button clicked', () => {
        const onDelete = vi.fn();
        render(
            <AgentActions
                agentId="agent-1"
                onRun={vi.fn()}
                onEdit={vi.fn()}
                onDelete={onDelete}
            />,
        );
        fireEvent.click(screen.getByTestId('agent-delete-btn'));
        expect(onDelete).toHaveBeenCalledWith('agent-1');
    });
});

describe('AgentTable', () => {
    const defaultProps = {
        agents: TEST_AGENTS,
        onRun: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
    };

    it('renders a row for each agent', () => {
        render(<AgentTable {...defaultProps} />);
        const rows = screen.getAllByTestId('agent-row');
        expect(rows).toHaveLength(TEST_AGENTS.length);
    });

    it('displays agent names', () => {
        render(<AgentTable {...defaultProps} />);
        for (const agent of TEST_AGENTS) {
            expect(screen.getByText(agent.name)).toBeTruthy();
        }
    });

    it('displays status badges', () => {
        render(<AgentTable {...defaultProps} />);
        const badges = screen.getAllByTestId('agent-status-badge');
        expect(badges).toHaveLength(TEST_AGENTS.length);
    });

    it('shows empty state when no agents', () => {
        render(<AgentTable {...defaultProps} agents={[]} />);
        expect(screen.getByTestId('agent-table-empty')).toBeTruthy();
        expect(screen.getByText(/No agents configured/)).toBeTruthy();
    });

    it('shows "Never" for agents that have not run', () => {
        const neverRunAgent: Agent = {
            ...TEST_AGENTS[0],
            id: 'never-run',
            lastRun: null,
        };
        render(<AgentTable {...defaultProps} agents={[neverRunAgent]} />);
        expect(screen.getByText('Never')).toBeTruthy();
    });
});

describe('AgentForm', () => {
    it('renders form fields', () => {
        render(<AgentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByTestId('agent-name-input')).toBeTruthy();
        expect(screen.getByTestId('agent-description-input')).toBeTruthy();
        expect(screen.getByTestId('agent-trigger-select')).toBeTruthy();
        expect(screen.getByTestId('agent-action-select')).toBeTruthy();
    });

    it('shows validation error when name is empty on submit', () => {
        const onSubmit = vi.fn();
        render(<AgentForm onSubmit={onSubmit} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByTestId('agent-submit-btn'));
        expect(screen.getByTestId('agent-name-error')).toBeTruthy();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('calls onSubmit with valid data', () => {
        const onSubmit = vi.fn();
        render(<AgentForm onSubmit={onSubmit} onCancel={vi.fn()} />);

        fireEvent.change(screen.getByTestId('agent-name-input'), {
            target: { value: 'My Agent' },
        });
        fireEvent.click(screen.getByTestId('agent-submit-btn'));

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'My Agent',
                config: expect.objectContaining({
                    triggerType: 'manual',
                    actionType: 'classify_tickets',
                }),
            }),
        );
    });

    it('calls onCancel when cancel clicked', () => {
        const onCancel = vi.fn();
        render(<AgentForm onSubmit={vi.fn()} onCancel={onCancel} />);
        fireEvent.click(screen.getByTestId('agent-cancel-btn'));
        expect(onCancel).toHaveBeenCalled();
    });

    it('shows interval field when interval trigger selected', () => {
        render(<AgentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByTestId('agent-trigger-select'), {
            target: { value: 'interval' },
        });
        expect(screen.getByTestId('agent-interval-input')).toBeTruthy();
    });

    it('shows cron field when cron trigger selected', () => {
        render(<AgentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByTestId('agent-trigger-select'), {
            target: { value: 'cron' },
        });
        expect(screen.getByTestId('agent-cron-input')).toBeTruthy();
    });

    it('shows webhook field when custom_webhook action selected', () => {
        render(<AgentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByTestId('agent-action-select'), {
            target: { value: 'custom_webhook' },
        });
        expect(screen.getByTestId('agent-webhook-input')).toBeTruthy();
    });

    it('pre-populates form when editing an existing agent', () => {
        const agent = TEST_AGENTS[0];
        render(<AgentForm agent={agent} onSubmit={vi.fn()} onCancel={vi.fn()} />);
        const nameInput = screen.getByTestId('agent-name-input') as HTMLInputElement;
        expect(nameInput.value).toBe(agent.name);
        expect(screen.getByTestId('agent-submit-btn').textContent).toContain('Update Agent');
    });

    it('shows "Create Agent" button for new agents', () => {
        render(<AgentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByTestId('agent-submit-btn').textContent).toContain('Create Agent');
    });
});
