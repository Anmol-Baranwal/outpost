'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, ArrowRight } from 'lucide-react';
import type { SyncEvent } from '@/lib/mock-sync';

interface ConflictQueueProps {
    conflicts: SyncEvent[];
    onResolve: (id: string, resolution: 'outpost' | 'external') => void;
}

export function ConflictQueue({ conflicts, onResolve }: ConflictQueueProps) {
    const [resolving, setResolving] = useState<string | null>(null);

    async function handleResolve(id: string, resolution: 'outpost' | 'external') {
        setResolving(id);
        await onResolve(id, resolution);
        setResolving(null);
    }

    if (conflicts.length === 0) {
        return (
            <div
                data-testid="conflict-queue-empty"
                className="rounded-xl border border-border bg-card p-8 text-center"
            >
                <Check className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
                <p className="text-sm text-muted-foreground">No unresolved conflicts</p>
            </div>
        );
    }

    return (
        <div data-testid="conflict-queue" className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-5 py-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold text-foreground">
                    Unresolved Conflicts ({conflicts.length})
                </span>
            </div>

            <div className="divide-y divide-border">
                {conflicts.map((conflict) => (
                    <div
                        key={conflict.id}
                        data-testid={`conflict-row-${conflict.id}`}
                        className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="font-mono text-foreground">{conflict.ticketId}</span>
                                <span className="text-muted-foreground">-</span>
                                <span className="text-muted-foreground capitalize">{conflict.conflictField}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                    {conflict.sourceValue}
                                </span>
                                <ArrowRight className="h-3 w-3" />
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                    {conflict.targetValue}
                                </span>
                                <span className="ml-2">
                                    {new Date(conflict.createdAt).toLocaleString()}
                                </span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                data-testid={`resolve-outpost-${conflict.id}`}
                                disabled={resolving === conflict.id}
                                onClick={() => handleResolve(conflict.id, 'outpost')}
                                className={cn(
                                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                    'bg-primary/15 text-primary hover:bg-primary/25',
                                    'disabled:opacity-50',
                                )}
                            >
                                Accept Outpost
                            </button>
                            <button
                                data-testid={`resolve-external-${conflict.id}`}
                                disabled={resolving === conflict.id}
                                onClick={() => handleResolve(conflict.id, 'external')}
                                className={cn(
                                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                    'bg-muted text-muted-foreground hover:bg-muted/80',
                                    'disabled:opacity-50',
                                )}
                            >
                                Accept External
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
