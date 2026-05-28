'use client';

import { useRouter, useParams } from 'next/navigation';
import { TicketPriority, TicketSource } from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import { truncate } from '@copilotkit/outpost/shared';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import type { Ticket } from './types';

interface TicketListProps {
    tickets: Ticket[];
    className?: string;
}

const priorityColors: Record<string, string> = {
    [TicketPriority.CRITICAL]: 'bg-destructive text-destructive-foreground',
    [TicketPriority.HIGH]: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    [TicketPriority.MEDIUM]: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    [TicketPriority.LOW]: 'bg-muted text-muted-foreground',
};

const priorityLabels: Record<string, string> = {
    [TicketPriority.CRITICAL]: 'Critical',
    [TicketPriority.HIGH]: 'High',
    [TicketPriority.MEDIUM]: 'Medium',
    [TicketPriority.LOW]: 'Low',
};

const sourceIcons: Record<string, string> = {
    [TicketSource.DISCORD]: 'D',
    [TicketSource.SLACK]: 'S',
    [TicketSource.TEAMS]: 'T',
    [TicketSource.ORCA]: 'O',
    [TicketSource.GITHUB_ISSUE]: 'GI',
    [TicketSource.GITHUB_DISCUSSION]: 'GD',
    [TicketSource.WEB]: 'W',
    [TicketSource.EMAIL]: 'E',
    [TicketSource.MANUAL]: 'M',
};

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TicketList({ tickets, className }: TicketListProps) {
    const router = useRouter();
    const params = useParams();
    const selectedTicketId = params?.ticketId as string | undefined;

    return (
        <div className={cn('flex flex-col', className)}>
            <div className="border-b border-border px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
                </span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {tickets.map((ticket) => {
                    const isSelected = selectedTicketId === ticket.id;
                    return (
                        <button
                            key={ticket.id}
                            onClick={() => router.push(`/tickets/${ticket.id}`)}
                            className={cn(
                                'w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors',
                                'hover:bg-accent/50 focus:outline-none focus:bg-accent/50',
                                isSelected && 'bg-primary/10 border-l-2 border-l-primary',
                            )}
                            data-testid={`ticket-card-${ticket.id}`}
                        >
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className="text-[10px] font-mono text-muted-foreground">
                                            {ticket.displayId}
                                        </span>
                                        <span
                                            className={cn(
                                                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                                                priorityColors[ticket.priority],
                                            )}
                                        >
                                            {priorityLabels[ticket.priority]}
                                        </span>
                                    </div>
                                    <p className="text-sm font-medium text-foreground leading-snug">
                                        {truncate(ticket.title, 60)}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                                        {truncate(ticket.description, 80)}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1.5">
                                        {ticket.account && (
                                            <span className="text-[10px] text-muted-foreground">
                                                {ticket.account.name}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-muted-foreground">
                                            {formatRelativeTime(ticket.createdAt)}
                                        </span>
                                        <span
                                            className="text-[10px] font-mono text-muted-foreground bg-muted px-1 rounded"
                                            title={ticket.source}
                                        >
                                            {sourceIcons[ticket.source]}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    );
                })}
                {tickets.length === 0 && (
                    <EmptyState
                        icon={<Inbox className="h-6 w-6" />}
                        title="No tickets found"
                        description="Tickets will appear here when customers reach out via Discord, GitHub, Slack, Teams, or email."
                        className="py-8"
                    />
                )}
            </div>
        </div>
    );
}
