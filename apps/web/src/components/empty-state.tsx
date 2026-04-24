'use client';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description: string;
    action?: { label: string; onClick: () => void };
    className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center py-12 px-6 text-center',
                className,
            )}
            data-testid="empty-state"
        >
            {icon && (
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
                    {icon}
                </div>
            )}
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
            {action && (
                <button
                    onClick={action.onClick}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    data-testid="empty-state-action"
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}
