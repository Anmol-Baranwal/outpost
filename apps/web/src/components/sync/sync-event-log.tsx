'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';
import type { SyncEvent, SyncEventStatus } from '@/lib/mock-sync';

interface SyncEventLogProps {
    events: SyncEvent[];
    onFilterChange: (filters: EventLogFilters) => void;
}

export interface EventLogFilters {
    sourcePlugin?: string;
    targetPlugin?: string;
    status?: SyncEventStatus;
}

const statusIcons: Record<SyncEventStatus, typeof CheckCircle> = {
    success: CheckCircle,
    failed: XCircle,
    conflict: AlertTriangle,
    pending: Clock,
};

const statusColors: Record<SyncEventStatus, string> = {
    success: 'text-emerald-400',
    failed: 'text-red-400',
    conflict: 'text-amber-400',
    pending: 'text-blue-400',
};

const statusLabels: Record<SyncEventStatus, string> = {
    success: 'Success',
    failed: 'Failed',
    conflict: 'Conflict',
    pending: 'Pending',
};

export function SyncEventLog({ events, onFilterChange }: SyncEventLogProps) {
    const [filters, setFilters] = useState<EventLogFilters>({});

    function updateFilter(key: keyof EventLogFilters, value: string) {
        const next = { ...filters, [key]: value || undefined };
        setFilters(next);
        onFilterChange(next);
    }

    return (
        <div data-testid="sync-event-log" className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Filters */}
            <div className="border-b border-border px-5 py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-foreground">Audit Log</span>
                <div className="ml-auto flex items-center gap-2">
                    <select
                        data-testid="filter-source"
                        value={filters.sourcePlugin ?? ''}
                        onChange={(e) => updateFilter('sourcePlugin', e.target.value)}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                        <option value="">All sources</option>
                        <option value="github">GitHub</option>
                        <option value="linear">Linear</option>
                        <option value="outpost">Outpost</option>
                    </select>
                    <select
                        data-testid="filter-status"
                        value={filters.status ?? ''}
                        onChange={(e) => updateFilter('status', e.target.value)}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                        <option value="">All statuses</option>
                        <option value="success">Success</option>
                        <option value="failed">Failed</option>
                        <option value="conflict">Conflict</option>
                        <option value="pending">Pending</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="px-5 py-2 text-left font-medium">Status</th>
                            <th className="px-5 py-2 text-left font-medium">Source</th>
                            <th className="px-5 py-2 text-left font-medium">Target</th>
                            <th className="px-5 py-2 text-left font-medium">Ticket</th>
                            <th className="px-5 py-2 text-left font-medium">Action</th>
                            <th className="px-5 py-2 text-left font-medium">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {events.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                                    No sync events found.
                                </td>
                            </tr>
                        )}
                        {events.map((event) => {
                            const StatusIcon = statusIcons[event.status];
                            return (
                                <tr key={event.id} data-testid={`event-row-${event.id}`} className="hover:bg-muted/30">
                                    <td className="px-5 py-2.5">
                                        <div className="flex items-center gap-1.5">
                                            <StatusIcon className={cn('h-3.5 w-3.5', statusColors[event.status])} />
                                            <span className={cn('text-xs', statusColors[event.status])}>
                                                {statusLabels[event.status]}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-2.5 capitalize text-foreground">{event.sourcePlugin}</td>
                                    <td className="px-5 py-2.5 capitalize text-foreground">{event.targetPlugin}</td>
                                    <td className="px-5 py-2.5 font-mono text-foreground">{event.ticketId}</td>
                                    <td className="px-5 py-2.5 text-muted-foreground">{event.action.replace('_', ' ')}</td>
                                    <td className="px-5 py-2.5 text-muted-foreground">
                                        {new Date(event.createdAt).toLocaleString()}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
