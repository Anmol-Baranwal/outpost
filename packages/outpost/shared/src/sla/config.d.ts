/**
 * SLA configuration: types, defaults, and DB loader.
 *
 * Default targets are used when no DB-level SlaConfig rows exist for a
 * given metric+priority pair.  loadSlaConfig() reads from the database
 * and merges with defaults so callers always get a complete map.
 */
import { SlaMetric, TicketPriority } from '../types.js';
/** Per-priority SLA target in minutes. */
export interface SlaTarget {
    firstResponseMinutes: number;
    resolutionMinutes: number;
}
/** Result of evaluating one ticket against its SLA targets. */
export interface SlaCheckResult {
    ticketId: string;
    priority: TicketPriority;
    firstResponseBreached: boolean;
    resolutionBreached: boolean;
    /** null when no response yet (still counting). */
    firstResponseTimeMs: number | null;
    /** null when ticket is not yet closed. */
    resolutionTimeMs: number | null;
    target: SlaTarget;
}
/** Emitted when a new breach is detected. */
export interface SlaBreachEvent {
    ticketId: string;
    metric: SlaMetric;
    priority: TicketPriority;
    elapsedMs: number;
    targetMs: number;
}
/** Complete map of priority → SlaTarget. */
export type SlaTargetMap = Record<TicketPriority, SlaTarget>;
/** Minimal interface for the SlaConfig query — avoids depending on @copilotkit/outpost/db. */
export interface SlaConfigRow {
    metric: string;
    priority: string;
    targetMinutes: number;
}
/** Minimal Prisma-like client needed for SLA operations. */
export interface SlaConfigClient {
    slaConfig: {
        findMany: () => Promise<SlaConfigRow[]>;
    };
}
export declare const DEFAULT_SLA_TARGETS: SlaTargetMap;
/**
 * Load SLA configuration from the database, falling back to built-in
 * defaults for any missing metric+priority combination.
 */
export declare function loadSlaConfig(prisma: SlaConfigClient): Promise<SlaTargetMap>;
//# sourceMappingURL=config.d.ts.map