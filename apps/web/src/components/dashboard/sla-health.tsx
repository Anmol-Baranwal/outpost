'use client';

import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SlaMetrics {
    slaBreaches: number;
    avgFirstResponseMs: number;
    avgResolutionMs: number;
}

function formatDuration(ms: number): string {
    if (ms <= 0) return '0 sec';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hr${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} min`);
    if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds} sec`);

    return parts.slice(0, 2).join(' ');
}

interface SlaHealthProps {
    metrics?: SlaMetrics;
}

export function SlaHealth({ metrics }: SlaHealthProps) {
    const cards = [
        {
            label: 'SLA Breaches',
            value: metrics ? String(metrics.slaBreaches) : '—',
            icon: AlertTriangle,
            color: metrics && metrics.slaBreaches > 0 ? 'text-destructive' : 'text-green-400',
            bgColor: metrics && metrics.slaBreaches > 0 ? 'bg-destructive/10' : 'bg-green-500/10',
        },
        {
            label: 'Avg First Response',
            value: metrics ? formatDuration(metrics.avgFirstResponseMs) : '—',
            icon: Clock,
            color: 'text-blue-400',
            bgColor: 'bg-blue-500/10',
        },
        {
            label: 'Avg Resolution Time',
            value: metrics ? formatDuration(metrics.avgResolutionMs) : '—',
            icon: CheckCircle2,
            color: 'text-purple-400',
            bgColor: 'bg-purple-500/10',
        },
    ];

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {cards.map((card) => (
                <div
                    key={card.label}
                    className="rounded-lg border border-border bg-card p-6"
                >
                    <div className="flex items-center gap-3">
                        <div
                            className={cn(
                                'flex h-10 w-10 items-center justify-center rounded-lg',
                                card.bgColor,
                            )}
                        >
                            <card.icon className={cn('h-5 w-5', card.color)} />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">
                                {card.label}
                            </p>
                            <p
                                className={cn(
                                    'text-2xl font-bold text-card-foreground',
                                )}
                                data-testid={`sla-${card.label.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                                {card.value}
                            </p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export { formatDuration };
