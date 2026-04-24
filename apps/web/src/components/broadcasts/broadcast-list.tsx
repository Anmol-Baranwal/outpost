'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { MockBroadcast, BroadcastStatus } from '@/lib/mock-broadcasts';

interface BroadcastListProps {
    broadcasts: MockBroadcast[];
    onStatusFilter: (status: BroadcastStatus | null) => void;
    activeFilter: BroadcastStatus | null;
}

const tabs: { label: string; value: BroadcastStatus | null }[] = [
    { label: 'All', value: null },
    { label: 'Draft', value: 'draft' },
    { label: 'Sent', value: 'sent' },
];

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function audienceLabel(broadcast: MockBroadcast): string {
    if (broadcast.audienceType === 'all') return 'All accounts';
    const names = broadcast.audienceAccounts.map((a) => a.name);
    if (names.length <= 2) return names.join(', ');
    return `${names[0]} +${names.length - 1} more`;
}

export function BroadcastList({ broadcasts, onStatusFilter, activeFilter }: BroadcastListProps) {
    return (
        <div>
            {/* Filter tabs */}
            <div className="mb-4 flex gap-1" data-testid="broadcast-tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.label}
                        onClick={() => onStatusFilter(tab.value)}
                        data-testid={`tab-${tab.label.toLowerCase()}`}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                            activeFilter === tab.value
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted',
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Broadcast cards */}
            {broadcasts.length === 0 ? (
                <div
                    className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
                    data-testid="broadcast-empty"
                >
                    No broadcasts yet. Use broadcasts to send messages to your customers.
                </div>
            ) : (
                <div className="space-y-3" data-testid="broadcast-cards">
                    {broadcasts.map((broadcast) => (
                        <div
                            key={broadcast.id}
                            data-testid={`broadcast-card-${broadcast.id}`}
                            className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/30"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm text-foreground line-clamp-2">
                                        {broadcast.message}
                                    </p>
                                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                                        <span>
                                            {broadcast.sentAt
                                                ? `Sent ${formatDate(broadcast.sentAt)}`
                                                : `Created ${formatDate(broadcast.createdAt)}`}
                                        </span>
                                        <span className="text-border">|</span>
                                        <span>{audienceLabel(broadcast)}</span>
                                        <span className="text-border">|</span>
                                        <span>by {broadcast.sender.name}</span>
                                    </div>
                                </div>
                                <span
                                    data-testid={`status-${broadcast.id}`}
                                    className={cn(
                                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                                        broadcast.status === 'draft'
                                            ? 'bg-yellow-100 text-yellow-800'
                                            : 'bg-green-100 text-green-800',
                                    )}
                                >
                                    {broadcast.status === 'draft' ? 'Draft' : 'Sent'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
