'use client';

import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/lib/mock-agents';

const STATUS_STYLES: Record<AgentStatus, string> = {
    ACTIVE: 'bg-green-500/10 text-green-400',
    PAUSED: 'bg-yellow-500/10 text-yellow-400',
    ERROR: 'bg-red-500/10 text-red-400',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
    ACTIVE: 'Active',
    PAUSED: 'Inactive',
    ERROR: 'Error',
};

interface AgentStatusBadgeProps {
    status: AgentStatus;
    className?: string;
}

export function AgentStatusBadge({ status, className }: AgentStatusBadgeProps) {
    return (
        <span
            data-testid="agent-status-badge"
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_STYLES[status],
                className,
            )}
        >
            {STATUS_LABELS[status]}
        </span>
    );
}
