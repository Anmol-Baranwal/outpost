/**
 * Conflict detection for bidirectional sync.
 *
 * When the same field on the same ticket is modified from two different
 * sources within the echo window, we have a conflict. Resolution strategy:
 * Outpost wins — the most recent Outpost state is canonical.
 *
 * Conflicts are logged as SyncEvents with status='conflict' so the
 * dashboard can surface them for human review.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface ConflictDetectorDeps {
    prisma: {
        syncEvent: {
            findFirst: (args: {
                where: Record<string, unknown>;
                orderBy?: Record<string, unknown>;
            }) => Promise<{
                id: string;
                sourcePlugin: string;
                targetPlugin: string;
                action: string;
                payloadHash: string;
                createdAt: Date;
            } | null>;
            create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
        };
    };
}

export interface ConflictInfo {
    /** The field that was modified concurrently */
    field: string;
    /** The source that made the conflicting change */
    conflictingSource: string;
    /** The source that wins (always 'outpost' in current strategy) */
    winningSource: string;
    /** ID of the logged conflict SyncEvent */
    syncEventId: string;
}

// ─── Default Config ───────────────────────────────────────────────────────

const DEFAULT_CONFLICT_WINDOW_MS = 60_000;

// ─── ConflictDetector ─────────────────────────────────────────────────────

export class ConflictDetector {
    private readonly deps: ConflictDetectorDeps;
    private readonly conflictWindowMs: number;

    constructor(deps: ConflictDetectorDeps, conflictWindowMs?: number) {
        this.deps = deps;
        this.conflictWindowMs = conflictWindowMs
            ?? (parseInt(process.env.SYNC_ECHO_WINDOW_MS ?? '', 10)
            || DEFAULT_CONFLICT_WINDOW_MS);
    }

    /**
     * Check for a conflict: was the same entity+action modified from a
     * DIFFERENT source within the conflict window?
     *
     * Returns null if no conflict, or ConflictInfo if there is one.
     * The conflicting SyncEvent is logged with status='conflict'.
     */
    async detectConflict(
        sourcePlugin: string,
        entityId: string,
        action: string,
    ): Promise<ConflictInfo | null> {
        const cutoff = new Date(Date.now() - this.conflictWindowMs);

        // Look for a recent sync event on the same entity+action from a
        // DIFFERENT source plugin
        const existing = await this.deps.prisma.syncEvent.findFirst({
            where: {
                entityId,
                action,
                sourcePlugin: { not: sourcePlugin },
                createdAt: { gte: cutoff },
                status: { not: 'conflict' },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!existing) {
            return null;
        }

        // We have a conflict — log it and resolve (Outpost wins)
        const conflictEvent = await this.deps.prisma.syncEvent.create({
            data: {
                sourcePlugin,
                targetPlugin: existing.sourcePlugin,
                entityType: 'ticket',
                entityId,
                action,
                payloadHash: existing.payloadHash,
                status: 'conflict',
                error: `Conflict: ${action} on ${entityId} from ${sourcePlugin} conflicts with recent change from ${existing.sourcePlugin}. Outpost state wins.`,
            },
        });

        return {
            field: action,
            conflictingSource: existing.sourcePlugin,
            winningSource: 'outpost',
            syncEventId: conflictEvent.id,
        };
    }

    /**
     * Resolve a conflict by returning the canonical Outpost value.
     *
     * This is a passthrough — the caller should already have the current
     * Outpost ticket state. This method exists to make the resolution
     * strategy explicit and swappable.
     */
    resolveConflict<T>(outpostValue: T, _externalValue: T): T {
        return outpostValue;
    }
}
