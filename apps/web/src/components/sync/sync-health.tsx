'use client';

import { cn } from '@/lib/utils';
import { Activity, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import type { SystemSyncStatus } from '@/lib/mock-sync';
import { getSyncHealthColor } from '@/lib/mock-sync';

interface SyncHealthCardsProps {
    systems: SystemSyncStatus[];
}

const colorClasses = {
    green: {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        dot: 'bg-emerald-400',
        border: 'border-emerald-500/30',
    },
    yellow: {
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        dot: 'bg-amber-400',
        border: 'border-amber-500/30',
    },
    red: {
        bg: 'bg-red-500/15',
        text: 'text-red-400',
        dot: 'bg-red-400',
        border: 'border-red-500/30',
    },
};

function formatTimeAgo(isoDate: string): string {
    const elapsed = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function SyncHealthCards({ systems }: SyncHealthCardsProps) {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="sync-health-cards">
            {systems.map((sys) => {
                const color = getSyncHealthColor(sys.lastSuccessfulSync);
                const classes = colorClasses[color];
                const pluginLabel = sys.plugin.charAt(0).toUpperCase() + sys.plugin.slice(1);

                return (
                    <div
                        key={sys.plugin}
                        data-testid={`sync-health-${sys.plugin}`}
                        data-health={color}
                        className={cn(
                            'rounded-xl border p-5 transition-colors',
                            'bg-card',
                            classes.border,
                        )}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Activity className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-semibold text-foreground">
                                    {pluginLabel}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span
                                    data-testid={`health-dot-${sys.plugin}`}
                                    className={cn('h-2 w-2 rounded-full', classes.dot)}
                                />
                                <span className={cn('text-xs font-medium', classes.text)}>
                                    {color === 'green' ? 'Healthy' : color === 'yellow' ? 'Degraded' : 'Down'}
                                </span>
                            </div>
                        </div>

                        {/* Metrics */}
                        <div className="space-y-2 text-sm">
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5" />
                                    Last sync
                                </span>
                                <span className="text-foreground">
                                    {formatTimeAgo(sys.lastSuccessfulSync)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    Pending
                                </span>
                                <span className="text-foreground">{sys.pendingCount}</span>
                            </div>
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Failed
                                </span>
                                <span className={sys.failedCount > 0 ? 'text-red-400' : 'text-foreground'}>
                                    {sys.failedCount}
                                </span>
                            </div>
                        </div>

                        {/* Latency */}
                        <div className="mt-3 pt-3 border-t border-border">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>p50: {sys.p50LatencyMs}ms</span>
                                <span>p95: {sys.p95LatencyMs}ms</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
