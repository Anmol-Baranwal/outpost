/**
 * Bidirectional status mapping between external tracker statuses
 * and Outpost TicketStatus values.
 *
 * Generic — works for any plugin. Factory functions provide
 * sensible defaults for known trackers.
 */

import { TicketStatus } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────

/** External status string → Outpost TicketStatus. */
export type StatusMappingConfig = Record<string, TicketStatus>;

// ─── StatusMap ────────────────────────────────────────────────────────────

export class StatusMap {
    /** External → Outpost lookup (lowercase keys). */
    private readonly toOutpostMap: Map<string, TicketStatus>;
    /** Outpost → External lookup (first match wins). */
    private readonly fromOutpostMap: Map<TicketStatus, string>;

    constructor(config: StatusMappingConfig) {
        this.toOutpostMap = new Map<string, TicketStatus>();
        this.fromOutpostMap = new Map<TicketStatus, string>();

        for (const [external, outpost] of Object.entries(config)) {
            const key = external.toLowerCase();
            this.toOutpostMap.set(key, outpost);

            // First external value for each Outpost status wins the reverse map.
            if (!this.fromOutpostMap.has(outpost)) {
                this.fromOutpostMap.set(outpost, external);
            }
        }
    }

    /** Map an external status string to TicketStatus. Falls back to OPEN. */
    toOutpost(externalStatus: string): TicketStatus {
        return this.toOutpostMap.get(externalStatus.toLowerCase()) ?? TicketStatus.OPEN;
    }

    /** Map an Outpost TicketStatus to the external status string. Falls back to first config entry. */
    fromOutpost(outpostStatus: TicketStatus): string {
        const mapped = this.fromOutpostMap.get(outpostStatus);
        if (mapped !== undefined) {
            return mapped;
        }
        // Fallback: return the first external string in the reverse map.
        const first = this.fromOutpostMap.values().next();
        return first.done ? 'open' : first.value;
    }

    /** Check if an external status has a known mapping. */
    hasExternal(externalStatus: string): boolean {
        return this.toOutpostMap.has(externalStatus.toLowerCase());
    }

    /** Check if an Outpost status has a known reverse mapping. */
    hasOutpost(outpostStatus: TicketStatus): boolean {
        return this.fromOutpostMap.has(outpostStatus);
    }
}

// ─── Factory Functions ────────────────────────────────────────────────────

/** GitHub issue statuses → Outpost. */
export function createGitHubStatusMap(): StatusMap {
    return new StatusMap({
        open: TicketStatus.OPEN,
        closed: TicketStatus.CLOSED,
    });
}

/** Linear workflow statuses → Outpost. */
export function createLinearStatusMap(): StatusMap {
    return new StatusMap({
        Triage: TicketStatus.OPEN,
        Backlog: TicketStatus.OPEN,
        Todo: TicketStatus.OPEN,
        'In Progress': TicketStatus.IN_PROGRESS,
        Done: TicketStatus.RESOLVED,
        Canceled: TicketStatus.CLOSED,
    });
}

// ─── Persisted Config Loading ─────────────────────────────────────────────

/** Must match the key used by apps/web/src/app/api/sync/mappings/route.ts. */
const MAPPING_CONFIG_KEY = 'sync.mappingConfig';

/** Minimal Prisma subset needed to load a persisted mapping config. */
export interface StatusMapDb {
    systemConfig: {
        findUnique(args: { where: { key: string } }): Promise<{ key: string; value: string } | null>;
    };
}

interface PersistedStatusMappingEntry {
    externalStatus: string;
    outpostStatus: TicketStatus;
}

/**
 * Build a StatusMap for `plugin`, preferring the persisted SystemConfig
 * row (written by the /api/sync/mappings dashboard) over the hardcoded
 * factory defaults. Falls back to the hardcoded default whenever the
 * config row is missing, malformed, or has no entry for this plugin.
 */
export async function loadStatusMap(
    plugin: 'linear' | 'github',
    db: StatusMapDb,
): Promise<StatusMap> {
    const fallback = plugin === 'linear' ? createLinearStatusMap() : createGitHubStatusMap();

    const row = await db.systemConfig.findUnique({ where: { key: MAPPING_CONFIG_KEY } });
    if (!row) return fallback;

    let parsed: unknown;
    try {
        parsed = JSON.parse(row.value);
    } catch {
        return fallback;
    }

    const entries = (parsed as { statusMappings?: Record<string, PersistedStatusMappingEntry[]> })
        ?.statusMappings?.[plugin];
    if (!Array.isArray(entries) || entries.length === 0) return fallback;

    const config: StatusMappingConfig = {};
    for (const entry of entries) {
        if (
            entry?.externalStatus &&
            entry?.outpostStatus &&
            Object.values(TicketStatus).includes(entry.outpostStatus as TicketStatus)
        ) {
            config[entry.externalStatus] = entry.outpostStatus;
        }
    }
    return Object.keys(config).length > 0 ? new StatusMap(config) : fallback;
}
