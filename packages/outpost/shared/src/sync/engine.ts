/**
 * SyncEngine — core orchestrator for bidirectional sync.
 *
 * Manages a registry of tracker plugins and coordinates change
 * fan-out between them. All actual push work is done asynchronously
 * via TRACKER_SYNC jobs in the queue.
 */

import type {
    ExternalTracker,
    InternalTracker,
    WebhookEvent,
    TicketChange,
    SyncResult,
    SyncEngineError,
    TicketChangeAction,
} from './types.js';
import { EchoGuard } from './echo-guard.js';

// ─── Types for Dependencies ────────────────────────────────────────────────

/**
 * Minimal Prisma-like interface so the engine doesn't import
 * the full Prisma client directly. Injected at construction.
 */
export interface SyncEngineDeps {
    prisma: {
        syncEvent?: {
            findFirst: (args: {
                where: Record<string, unknown>;
                orderBy?: Record<string, unknown>;
            }) => Promise<{ id: string; createdAt: Date } | null>;
            create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
        };
        ticketExternalLink: {
            findMany: (args: {
                where: Record<string, unknown>;
            }) => Promise<Array<{
                id: string;
                ticketId: string;
                plugin: string;
                externalId: string;
                externalUrl?: string | null;
                metadata?: Record<string, unknown> | null;
            }>>;
            findUnique: (args: {
                where: Record<string, unknown>;
            }) => Promise<{
                id: string;
                ticketId: string;
                plugin: string;
                externalId: string;
                externalUrl?: string | null;
                metadata?: Record<string, unknown> | null;
            } | null>;
        };
        ticket: {
            findUnique: (args: {
                where: Record<string, unknown>;
                include?: Record<string, unknown>;
            }) => Promise<Record<string, unknown> | null>;
            update: (args: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
            }) => Promise<Record<string, unknown>>;
        };
    };
    createJob: (type: string, payload: Record<string, unknown>) => Promise<string>;
    echoGuard?: EchoGuard;
}

// ─── SyncEngine ────────────────────────────────────────────────────────────

export class SyncEngine {
    private externalTrackers: Map<string, ExternalTracker> = new Map();
    private internalTrackers: Map<string, InternalTracker> = new Map();
    private deps: SyncEngineDeps;
    private echoGuard: EchoGuard;

    constructor(deps: SyncEngineDeps) {
        this.deps = deps;
        // Use injected EchoGuard, or construct one from prisma.syncEvent for backward compat
        if (deps.echoGuard) {
            this.echoGuard = deps.echoGuard;
        } else if (deps.prisma.syncEvent) {
            this.echoGuard = new EchoGuard({ prisma: { syncEvent: deps.prisma.syncEvent } });
        } else {
            throw new Error('SyncEngineDeps must provide either echoGuard or prisma.syncEvent');
        }
    }

    // ─── Plugin Registry ───────────────────────────────────────────────

    /** Register an external tracker plugin. */
    registerExternalTracker(tracker: ExternalTracker): void {
        if (this.externalTrackers.has(tracker.name) || this.internalTrackers.has(tracker.name)) {
            throw new Error(`Plugin "${tracker.name}" is already registered`);
        }
        this.externalTrackers.set(tracker.name, tracker);
    }

    /** Register an internal tracker plugin. */
    registerInternalTracker(tracker: InternalTracker): void {
        if (this.externalTrackers.has(tracker.name) || this.internalTrackers.has(tracker.name)) {
            throw new Error(`Plugin "${tracker.name}" is already registered`);
        }
        this.internalTrackers.set(tracker.name, tracker);
    }

    /** Get a plugin by name (external or internal). */
    getPlugin(name: string): ExternalTracker | InternalTracker | undefined {
        return this.internalTrackers.get(name) ?? this.externalTrackers.get(name);
    }

    /** Get all registered plugin names. */
    getPluginNames(): string[] {
        return [
            ...this.externalTrackers.keys(),
            ...this.internalTrackers.keys(),
        ];
    }

    /** Check if a plugin is an InternalTracker. */
    isInternalTracker(name: string): boolean {
        return this.internalTrackers.has(name);
    }

    // ─── Change Fan-Out ────────────────────────────────────────────────

    /**
     * Fan out a ticket change to all plugins EXCEPT the source.
     *
     * Instead of calling plugins directly, this enqueues TRACKER_SYNC
     * jobs so the work happens asynchronously with retries.
     */
    async onTicketChange(
        ticketId: string,
        change: TicketChange,
        sourcePlugin: string,
    ): Promise<SyncResult> {
        const errors: SyncEngineError[] = [];
        let pluginsNotified = 0;

        const allPluginNames = this.getPluginNames();

        for (const pluginName of allPluginNames) {
            if (pluginName === sourcePlugin) {
                continue;
            }

            const payloadHash = EchoGuard.computeHash({
                entityId: ticketId,
                targetPlugin: pluginName,
                action: change.action,
                status: change.status,
                priority: change.priority,
                comment: change.comment,
                labels: change.labels,
            });

            // Echo detection: skip if we recently synced this exact change
            const shouldSync = await this.echoGuard.shouldSync(
                sourcePlugin,
                pluginName,
                ticketId,
                payloadHash,
            );

            if (!shouldSync) {
                continue;
            }

            try {
                await this.deps.createJob('TRACKER_SYNC', {
                    ticketId,
                    targetPlugin: pluginName,
                    action: change.action,
                    changeData: change,
                });
                pluginsNotified++;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                errors.push({
                    plugin: pluginName,
                    action: change.action,
                    error: message,
                });
            }
        }

        return {
            success: errors.length === 0,
            pluginsNotified,
            errors,
        };
    }

    // ─── Webhook Processing ────────────────────────────────────────────

    /**
     * Process an incoming webhook from an external system.
     *
     * 1. Look up the plugin
     * 2. Let the plugin parse the webhook into a TicketChange
     * 3. If the change maps to an existing ticket, update it and fan out
     * 4. Return the sync result
     */
    async onWebhookReceived(
        pluginName: string,
        event: WebhookEvent,
    ): Promise<SyncResult> {
        const plugin = this.getPlugin(pluginName);
        if (!plugin) {
            return {
                success: false,
                pluginsNotified: 0,
                errors: [{
                    plugin: pluginName,
                    action: 'webhook',
                    error: `Plugin "${pluginName}" is not registered`,
                }],
            };
        }

        const change = await plugin.onWebhookReceived(event);
        if (!change) {
            // Plugin decided to skip this event
            return { success: true, pluginsNotified: 0, errors: [] };
        }

        // Find the ticket linked to this external ID
        const link = await this.deps.prisma.ticketExternalLink.findUnique({
            where: {
                plugin_externalId: {
                    plugin: pluginName,
                    externalId: change.externalId,
                },
            },
        });

        if (!link) {
            // No linked ticket found — nothing to sync
            return { success: true, pluginsNotified: 0, errors: [] };
        }

        // Apply the change locally if it's a status update
        if (change.action === 'status_change' && change.status) {
            await this.deps.prisma.ticket.update({
                where: { id: link.ticketId },
                data: { status: change.status },
            });
        }

        // Fan out to other plugins
        return this.onTicketChange(link.ticketId, change, pluginName);
    }

    // ─── Echo Detection (delegated to EchoGuard) ──────────────────────

    /**
     * Check if a matching SyncEvent was created recently, indicating
     * this change is an echo (bounce-back from our own push).
     */
    async isEchoEvent(
        entityId: string,
        sourcePlugin: string,
        targetPlugin: string,
        payloadHash: string,
    ): Promise<boolean> {
        const shouldSync = await this.echoGuard.shouldSync(
            sourcePlugin,
            targetPlugin,
            entityId,
            payloadHash,
        );
        return !shouldSync;
    }

    /**
     * Record a SyncEvent after a push completes (success or failure).
     */
    async recordSyncEvent(
        sourcePlugin: string,
        targetPlugin: string,
        _entityType: string,
        entityId: string,
        action: string,
        payloadHash: string,
        status: 'success' | 'failure',
        error?: string,
    ): Promise<void> {
        await this.echoGuard.recordSync(
            sourcePlugin,
            targetPlugin,
            entityId,
            action,
            payloadHash,
            status,
            error,
        );
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    /** Compute a deterministic hash for echo detection. */
    computeHash(
        entityId: string,
        targetPlugin: string,
        action: TicketChangeAction | string,
        change: Record<string, unknown>,
    ): string {
        return EchoGuard.computeHash({
            entityId,
            targetPlugin,
            action,
            status: change.status,
            priority: change.priority,
            comment: change.comment,
            labels: change.labels,
        });
    }
}
