'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

interface HubSpotStatus {
    connected: boolean;
    lastSyncAt: string | null;
    lastSyncResult: {
        created: number;
        updated: number;
        skipped: number;
        errorCount: number;
    } | null;
    message: string;
}

interface SyncResult {
    status: string;
    message: string;
    queuedAt: string;
}

export default function SettingsPage() {
    const [hubspotStatus, setHubspotStatus] = useState<HubSpotStatus | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/integrations/hubspot/status');
            if (!res.ok) throw new Error('Failed to fetch status');
            const data = await res.json();
            setHubspotStatus(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch HubSpot status');
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        setError(null);

        try {
            const res = await fetch('/api/integrations/hubspot/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error('Failed to trigger sync');
            const data = await res.json();
            setSyncResult(data);
            // Refresh status after sync
            await fetchStatus();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sync failed');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div>
            <PageHeader
                title="Settings"
                description="Manage integrations and configuration."
                icon={Settings}
                breadcrumbs={[{ label: 'Settings' }]}
            />

            <div className="space-y-6">
                {/* HubSpot Integration Card */}
                <div className="rounded-lg border border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                                <span className="text-lg font-bold text-orange-500">H</span>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold">HubSpot CRM</h3>
                                <p className="text-sm text-muted-foreground">
                                    Sync account data from HubSpot
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {hubspotStatus?.connected ? (
                                <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-sm font-medium text-green-500">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Connected
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-sm font-medium text-red-500">
                                    <XCircle className="h-4 w-4" />
                                    Not Connected
                                </span>
                            )}
                        </div>
                    </div>

                    {hubspotStatus && (
                        <p className="text-sm text-muted-foreground mb-4">
                            {hubspotStatus.message}
                        </p>
                    )}

                    {/* Last sync info */}
                    {hubspotStatus?.lastSyncAt && (
                        <div className="mb-4 rounded-md bg-muted/50 p-3">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                <Clock className="h-4 w-4" />
                                Last synced: {new Date(hubspotStatus.lastSyncAt).toLocaleString()}
                            </div>
                            {hubspotStatus.lastSyncResult && (
                                <div className="grid grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <span className="text-muted-foreground">Created:</span>{' '}
                                        <span className="font-medium">{hubspotStatus.lastSyncResult.created}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Updated:</span>{' '}
                                        <span className="font-medium">{hubspotStatus.lastSyncResult.updated}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Skipped:</span>{' '}
                                        <span className="font-medium">{hubspotStatus.lastSyncResult.skipped}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Errors:</span>{' '}
                                        <span className={`font-medium ${hubspotStatus.lastSyncResult.errorCount > 0 ? 'text-red-500' : ''}`}>
                                            {hubspotStatus.lastSyncResult.errorCount}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Sync result feedback */}
                    {syncResult && (
                        <div className="mb-4 rounded-md bg-blue-500/10 p-3 text-sm text-blue-400">
                            {syncResult.message}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleSync}
                        disabled={syncing || !hubspotStatus?.connected}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                </div>
            </div>
        </div>
    );
}
