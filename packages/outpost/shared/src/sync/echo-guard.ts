/**
 * EchoGuard — loop prevention layer for bidirectional sync.
 *
 * Wraps SyncEvent table checks to prevent echo loops where a change
 * pushed to system A bounces back as a webhook from A and gets
 * pushed again.
 *
 * Usage:
 *   const guard = new EchoGuard(deps);
 *   if (await guard.shouldSync('linear', 'github', ticketId, hash)) {
 *       await doPush();
 *       await guard.recordSync('linear', 'github', ticketId, 'status_change', hash, 'success');
 *   }
 */

import { createHash } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────

export interface EchoGuardDeps {
    prisma: {
        syncEvent: {
            findFirst: (args: {
                where: Record<string, unknown>;
                orderBy?: Record<string, unknown>;
            }) => Promise<{ id: string; createdAt: Date } | null>;
            create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
        };
    };
}

export type SyncEventStatus = 'success' | 'failure' | 'conflict';

// ─── Default Config ───────────────────────────────────────────────────────

const DEFAULT_ECHO_WINDOW_MS = 60_000;

// ─── EchoGuard ────────────────────────────────────────────────────────────

export class EchoGuard {
    private readonly deps: EchoGuardDeps;
    private readonly echoWindowMs: number;

    constructor(deps: EchoGuardDeps, echoWindowMs?: number) {
        this.deps = deps;
        this.echoWindowMs = echoWindowMs
            ?? (parseInt(process.env.SYNC_ECHO_WINDOW_MS ?? '', 10)
            || DEFAULT_ECHO_WINDOW_MS);
    }

    /**
     * Check whether this sync should proceed.
     *
     * Returns false if a matching SyncEvent exists within the echo window,
     * meaning the change is a bounce-back from our own push.
     *
     * The check looks for a recent event where the target pushed TO the source
     * (reverse direction) with the same payload hash — that means we already
     * pushed this exact change and the source is echoing it back.
     */
    async shouldSync(
        sourcePlugin: string,
        targetPlugin: string,
        entityId: string,
        payloadHash: string,
    ): Promise<boolean> {
        const cutoff = new Date(Date.now() - this.echoWindowMs);

        const existing = await this.deps.prisma.syncEvent.findFirst({
            where: {
                entityId,
                sourcePlugin: targetPlugin,
                targetPlugin: sourcePlugin,
                payloadHash,
                createdAt: { gte: cutoff },
            },
            orderBy: { createdAt: 'desc' },
        });

        return existing === null;
    }

    /**
     * Record a SyncEvent after a sync operation completes.
     */
    async recordSync(
        sourcePlugin: string,
        targetPlugin: string,
        entityId: string,
        action: string,
        payloadHash: string,
        status: SyncEventStatus,
        error?: string,
    ): Promise<void> {
        await this.deps.prisma.syncEvent.create({
            data: {
                sourcePlugin,
                targetPlugin,
                entityType: 'ticket',
                entityId,
                action,
                payloadHash,
                status,
                error: error ?? null,
            },
        });
    }

    /**
     * Compute a deterministic hash for a sync payload.
     * Used as the payloadHash for echo detection.
     */
    static computeHash(parts: Record<string, unknown>): string {
        const canonical = JSON.stringify(parts, Object.keys(parts).sort());
        return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
    }
}
