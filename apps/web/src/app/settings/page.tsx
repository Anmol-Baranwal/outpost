'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Settings, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api-fetch';

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
    const { data: session } = useSession();
    const router = useRouter();
    const isAdmin = (session?.user as Record<string, unknown> | undefined)?.role === 'ADMIN';

    const [hubspotStatus, setHubspotStatus] = useState<HubSpotStatus | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Factory reset state
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetConfirmation, setResetConfirmation] = useState('');
    const [resetReseed, setResetReseed] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);
    const [resetSuccess, setResetSuccess] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await apiFetch('/api/integrations/hubspot/status');
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
            const res = await apiFetch('/api/integrations/hubspot/sync', {
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

    const handleFactoryReset = async () => {
        setResetting(true);
        setResetError(null);

        try {
            const res = await apiFetch('/api/admin/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: resetConfirmation, reseed: resetReseed }),
            });
            const data = await res.json();
            if (!res.ok) {
                setResetError(data.error || 'Factory reset failed');
                return;
            }
            setResetSuccess(true);
            setShowResetModal(false);
            setResetConfirmation('');
            setResetReseed(false);
            // Redirect to dashboard after a brief pause
            setTimeout(() => router.push('/dashboard'), 1500);
        } catch {
            setResetError('Factory reset failed. Please try again.');
        } finally {
            setResetting(false);
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

                {/* Danger Zone - Admin Only */}
                {isAdmin && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                            <h3 className="text-lg font-semibold text-destructive">Danger Zone</h3>
                        </div>

                        {resetSuccess && (
                            <div className="mb-4 rounded-md bg-green-500/10 p-3 text-sm text-green-400">
                                Factory reset complete. Redirecting to dashboard...
                            </div>
                        )}

                        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-card p-4">
                            <div>
                                <h4 className="text-sm font-semibold text-foreground">Factory Reset</h4>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Permanently delete all data and start fresh. Only your admin account and organization will be preserved.
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setShowResetModal(true);
                                    setResetError(null);
                                    setResetConfirmation('');
                                    setResetReseed(false);
                                }}
                                className="ml-4 shrink-0 rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                            >
                                Reset to Factory
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Factory Reset Modal */}
            {showResetModal && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !resetting) {
                            setShowResetModal(false);
                        }
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Factory Reset"
                        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
                    >
                        {/* Header */}
                        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                            <h2 className="text-lg font-semibold text-foreground">Factory Reset</h2>
                        </div>

                        {/* Body */}
                        <div className="space-y-4 px-6 py-4">
                            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                                This will permanently delete all data including tickets, messages,
                                accounts, users, agents, broadcasts, and docs. Only your admin account
                                and organization will be preserved.
                            </div>

                            {resetError && (
                                <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                                    {resetError}
                                </div>
                            )}

                            {/* Re-seed checkbox */}
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={resetReseed}
                                    onChange={(e) => setResetReseed(e.target.checked)}
                                    className="rounded border-border"
                                    disabled={resetting}
                                />
                                Re-seed with demo data after reset
                            </label>

                            {/* Confirmation input */}
                            <div>
                                <label htmlFor="reset-confirmation" className="block text-sm font-medium text-muted-foreground mb-1">
                                    Type RESET to confirm
                                </label>
                                <input
                                    id="reset-confirmation"
                                    type="text"
                                    value={resetConfirmation}
                                    onChange={(e) => setResetConfirmation(e.target.value)}
                                    placeholder="RESET"
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                    disabled={resetting}
                                    autoComplete="off"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
                            <button
                                onClick={() => setShowResetModal(false)}
                                disabled={resetting}
                                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleFactoryReset}
                                disabled={resetConfirmation !== 'RESET' || resetting}
                                className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {resetting ? (
                                    <>
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                        Resetting...
                                    </>
                                ) : (
                                    'Reset Everything'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
