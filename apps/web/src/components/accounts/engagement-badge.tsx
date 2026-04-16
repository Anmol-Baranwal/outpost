'use client';

import { AccountEngagement } from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';

interface EngagementBadgeProps {
    engagement: AccountEngagement;
    className?: string;
}

const ENGAGEMENT_CONFIG: Record<AccountEngagement, { label: string; color: string }> = {
    [AccountEngagement.HIGH]: {
        label: 'High',
        color: 'bg-blue-100 text-blue-700',
    },
    [AccountEngagement.MEDIUM]: {
        label: 'Medium',
        color: 'bg-slate-100 text-slate-600',
    },
    [AccountEngagement.LOW]: {
        label: 'Low',
        color: 'bg-yellow-100 text-yellow-700',
    },
    [AccountEngagement.INACTIVE]: {
        label: 'Inactive',
        color: 'bg-red-100 text-red-700',
    },
};

export function EngagementBadge({ engagement, className }: EngagementBadgeProps) {
    const config = ENGAGEMENT_CONFIG[engagement];
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                config.color,
                className,
            )}
            data-testid="engagement-badge"
        >
            {config.label}
        </span>
    );
}
