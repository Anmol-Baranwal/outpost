'use client';

import { useRouter, useParams } from 'next/navigation';
import { TicketPriority, TicketSource } from '@outpost/shared';
import { cn } from '@/lib/utils';
import { truncate } from '@outpost/shared';
import type { MockTicket } from '@/lib/mock-tickets';

interface TicketListProps {
    tickets: MockTicket[];
    className?: string;
}

const priorityColors: Record<string, string> = {
    [TicketPriority.CRITICAL]: 'bg-red-600 text-white',
    [TicketPriority.HIGH]: 'bg-red-100 text-red-700',
    [TicketPriority.MEDIUM]: 'bg-yellow-100 text-yellow-700',
    [TicketPriority.LOW]: 'bg-slate-100 text-slate-600',
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
            <div className="border-b border-slate-200 px-3 py-2">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
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
                                'w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors',
                                'hover:bg-slate-50 focus:outline-none focus:bg-slate-50',
                                isSelected && 'bg-blue-50 border-l-2 border-l-blue-500',
                            )}
                            data-testid={`ticket-card-${ticket.id}`}
                        >
                            <div className="flex items-start gap-2">
                                {ticket.unread && (
                                    <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className="text-[10px] font-mono text-slate-400">
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
                                    <p className="text-sm font-medium text-slate-800 leading-snug">
                                        {truncate(ticket.title, 60)}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                                        {truncate(ticket.description, 80)}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1.5">
                                        {ticket.account && (
                                            <span className="text-[10px] text-slate-400">
                                                {ticket.account.name}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-slate-400">
                                            {formatRelativeTime(ticket.createdAt)}
                                        </span>
                                        <span
                                            className="text-[10px] font-mono text-slate-300 bg-slate-50 px-1 rounded"
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
                    <div className="p-6 text-center text-sm text-slate-400">
                        No tickets match the current filters.
                    </div>
                )}
            </div>
        </div>
    );
}
