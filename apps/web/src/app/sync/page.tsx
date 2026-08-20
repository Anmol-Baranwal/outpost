'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SyncHealthCards } from '@/components/sync/sync-health';
import { ConflictQueue } from '@/components/sync/conflict-queue';
import { SyncEventLog } from '@/components/sync/sync-event-log';
import type { EventLogFilters } from '@/components/sync/sync-event-log';
import type { SystemSyncStatus, SyncEvent } from '@/lib/mock-sync';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-fetch';

export default function SyncPage() {
    const [systems, setSystems] = useState<SystemSyncStatus[]>([]);
    const [events, setEvents] = useState<SyncEvent[]>([]);
    const [conflicts, setConflicts] = useState<SyncEvent[]>([]);
    const [forcing, setForcing] = useState<string | null>(null);
    const [forceNotice, setForceNotice] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await apiFetch('/api/sync/status');
            const data = await res.json();
            setSystems(data.systems);
        } catch {
            // noop
        }
    }, []);

    const fetchEvents = useCallback(async (filters?: EventLogFilters) => {
        try {
            const params = new URLSearchParams();
            if (filters?.sourcePlugin) params.set('sourcePlugin', filters.sourcePlugin);
            if (filters?.status) params.set('status', filters.status);
            const res = await apiFetch(`/api/sync/events?${params.toString()}`);
            const data = await res.json();
            setEvents(data.events);
        } catch {
            // noop
        }
    }, []);

    const fetchConflicts = useCallback(async () => {
        try {
            const res = await apiFetch('/api/sync/conflicts');
            const data = await res.json();
            setConflicts(data.conflicts);
        } catch {
            // noop
        }
    }, []);

    useEffect(() => {
        fetchStatus();
        fetchEvents();
        fetchConflicts();
    }, [fetchStatus, fetchEvents, fetchConflicts]);

    async function handleForceSync(plugin: string) {
        setForcing(plugin);
        setForceNotice(null);
        try {
            const res = await apiFetch('/api/sync/force', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plugin }),
            });
            const data = await res.json().catch(() => null);

            // A force sync that partially or wholly did nothing has to say so.
            // The route skips changes whose value has no reverse mapping for this
            // plugin — silently dropping that on the floor would just trade a
            // silent wrong write for a silent no-write.
            if (!res.ok) {
                setForceNotice(data?.error ?? `Force sync failed (${res.status}).`);
            } else if (data?.skipped > 0) {
                setForceNotice(
                    `Queued ${data.jobs} job(s). Skipped ${data.skipped} change(s) with no ` +
                        `mapping for ${plugin}: ${data.unmappable.join(', ')}. Add mappings on ` +
                        `the Mappings tab, or those tickets stay out of sync.`,
                );
            }

            await fetchStatus();
            await fetchEvents();
        } finally {
            setForcing(null);
        }
    }

    async function handleResolveConflict(id: string, resolution: 'outpost' | 'external') {
        try {
            await apiFetch(`/api/sync/conflicts/${id}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution }),
            });
            await fetchConflicts();
            await fetchEvents();
        } catch {
            // noop
        }
    }

    return (
        <div>
            <PageHeader
                title="Sync"
                description="Monitor bidirectional sync health across connected systems."
                icon={RefreshCw}
                breadcrumbs={[{ label: 'Sync' }]}
            />

            <div className="space-y-6">
                {/* Health cards with force sync buttons */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-foreground">System Health</h2>
                        <div className="flex items-center gap-2">
                            {/*
                             * Only plugins the worker can actually sync to get a
                             * button. A plugin can appear in System Health (it has
                             * sync events) while having no registered outbound
                             * adapter — forcing one of those just floods the DLQ.
                             */}
                            {systems
                                .filter((sys) => sys.canForceSync)
                                .map((sys) => (
                                    <button
                                        key={sys.plugin}
                                        data-testid={`force-sync-${sys.plugin}`}
                                        disabled={forcing !== null}
                                        onClick={() => handleForceSync(sys.plugin)}
                                        className={cn(
                                            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                            'border border-border bg-background text-foreground hover:bg-muted',
                                            'disabled:opacity-50',
                                        )}
                                    >
                                        <RefreshCw
                                            className={cn(
                                                'h-3 w-3',
                                                forcing === sys.plugin && 'animate-spin',
                                            )}
                                        />
                                        Force{' '}
                                        {sys.plugin.charAt(0).toUpperCase() + sys.plugin.slice(1)}
                                    </button>
                                ))}
                        </div>
                    </div>
                    {forceNotice && (
                        <div
                            data-testid="force-sync-notice"
                            className="mb-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
                        >
                            {forceNotice}
                        </div>
                    )}
                    <SyncHealthCards systems={systems} />
                </div>

                {/* Conflict queue */}
                <ConflictQueue conflicts={conflicts} onResolve={handleResolveConflict} />

                {/* Audit log */}
                <SyncEventLog events={events} onFilterChange={fetchEvents} />
            </div>
        </div>
    );
}
