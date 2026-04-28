'use client';

import type { AgentStatus } from './agent-status-badge';
import { AgentStatusBadge } from './agent-status-badge';
import { AgentActions } from './agent-actions';

export interface Agent {
    id: string;
    name: string;
    description: string | null;
    config: Record<string, unknown>;
    lastRun: string | null;
    status: AgentStatus;
    createdAt: string;
    updatedAt: string;
}

interface AgentTableProps {
    agents: Agent[];
    onRun: (id: string) => void;
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
}

function formatLastRun(lastRun: string | null): string {
    if (!lastRun) return 'Never';
    const date = new Date(lastRun);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function AgentTable({ agents, onRun, onEdit, onDelete }: AgentTableProps) {
    if (agents.length === 0) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground" data-testid="agent-table-empty">
                No agents configured. Create an agent to automate support tasks.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto" data-testid="agent-table">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                        <th className="px-4 py-3">Agent Name</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Last Run</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {agents.map((agent) => (
                        <tr
                            key={agent.id}
                            className="border-b border-border/50 hover:bg-accent/50 transition-colors"
                            data-testid="agent-row"
                        >
                            <td className="px-4 py-3 font-medium text-foreground">
                                {agent.name}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground max-w-[300px] truncate">
                                {agent.description || '--'}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                {formatLastRun(agent.lastRun)}
                            </td>
                            <td className="px-4 py-3">
                                <AgentStatusBadge status={agent.status} />
                            </td>
                            <td className="px-4 py-3 text-right">
                                <AgentActions
                                    agentId={agent.id}
                                    onRun={onRun}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
