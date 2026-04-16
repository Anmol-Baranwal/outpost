/**
 * Bidirectional priority mapping between external tracker priorities
 * and Outpost TicketPriority values.
 *
 * Generic — works for any plugin. Factory functions provide
 * sensible defaults for known trackers.
 */

import { TicketPriority } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────

/** External priority string → Outpost TicketPriority. */
export type PriorityMappingConfig = Record<string, TicketPriority>;

// ─── PriorityMap ──────────────────────────────────────────────────────────

export class PriorityMap {
    /** External → Outpost lookup (lowercase keys). */
    private readonly toOutpostMap: Map<string, TicketPriority>;
    /** Outpost → External lookup (first match wins). */
    private readonly fromOutpostMap: Map<TicketPriority, string>;

    constructor(config: PriorityMappingConfig) {
        this.toOutpostMap = new Map<string, TicketPriority>();
        this.fromOutpostMap = new Map<TicketPriority, string>();

        for (const [external, outpost] of Object.entries(config)) {
            const key = external.toLowerCase();
            this.toOutpostMap.set(key, outpost);

            if (!this.fromOutpostMap.has(outpost)) {
                this.fromOutpostMap.set(outpost, external);
            }
        }
    }

    /** Map an external priority string to TicketPriority. Falls back to MEDIUM. */
    toOutpost(externalPriority: string): TicketPriority {
        return this.toOutpostMap.get(externalPriority.toLowerCase()) ?? TicketPriority.MEDIUM;
    }

    /** Map an Outpost TicketPriority to the external priority string. */
    fromOutpost(outpostPriority: TicketPriority): string {
        const mapped = this.fromOutpostMap.get(outpostPriority);
        if (mapped !== undefined) {
            return mapped;
        }
        const first = this.fromOutpostMap.values().next();
        return first.done ? 'medium' : first.value;
    }

    /** Check if an external priority has a known mapping. */
    hasExternal(externalPriority: string): boolean {
        return this.toOutpostMap.has(externalPriority.toLowerCase());
    }

    /** Check if an Outpost priority has a known reverse mapping. */
    hasOutpost(outpostPriority: TicketPriority): boolean {
        return this.fromOutpostMap.has(outpostPriority);
    }
}

// ─── Factory Functions ────────────────────────────────────────────────────

/**
 * Linear priorities (numeric strings) → Outpost.
 *
 * Linear: 0 = None, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
 */
export function createLinearPriorityMap(): PriorityMap {
    return new PriorityMap({
        '0': TicketPriority.MEDIUM,   // None → MEDIUM
        '1': TicketPriority.CRITICAL, // Urgent
        '2': TicketPriority.HIGH,     // High
        '3': TicketPriority.MEDIUM,   // Medium
        '4': TicketPriority.LOW,      // Low
    });
}

/**
 * GitHub label-based priorities → Outpost.
 *
 * GitHub has no native priority field; teams use labels like
 * "priority:critical", "priority:high", etc.  The LabelMapper
 * strips the prefix before this map sees the value.
 */
export function createGitHubPriorityMap(): PriorityMap {
    return new PriorityMap({
        critical: TicketPriority.CRITICAL,
        high: TicketPriority.HIGH,
        medium: TicketPriority.MEDIUM,
        low: TicketPriority.LOW,
    });
}
