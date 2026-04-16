/**
 * SLA configuration: types, defaults, and DB loader.
 *
 * Default targets are used when no DB-level SlaConfig rows exist for a
 * given metric+priority pair.  loadSlaConfig() reads from the database
 * and merges with defaults so callers always get a complete map.
 */
import { SlaMetric, TicketPriority } from '../types.js';
import { DEFAULT_SLA_FIRST_RESPONSE, DEFAULT_SLA_RESOLUTION, } from '../constants.js';
// ─── Defaults ───────────────────────────────────────────────────────────────
export const DEFAULT_SLA_TARGETS = {
    [TicketPriority.CRITICAL]: {
        firstResponseMinutes: DEFAULT_SLA_FIRST_RESPONSE.CRITICAL,
        resolutionMinutes: DEFAULT_SLA_RESOLUTION.CRITICAL,
    },
    [TicketPriority.HIGH]: {
        firstResponseMinutes: DEFAULT_SLA_FIRST_RESPONSE.HIGH,
        resolutionMinutes: DEFAULT_SLA_RESOLUTION.HIGH,
    },
    [TicketPriority.MEDIUM]: {
        firstResponseMinutes: DEFAULT_SLA_FIRST_RESPONSE.MEDIUM,
        resolutionMinutes: DEFAULT_SLA_RESOLUTION.MEDIUM,
    },
    [TicketPriority.LOW]: {
        firstResponseMinutes: DEFAULT_SLA_FIRST_RESPONSE.LOW,
        resolutionMinutes: DEFAULT_SLA_RESOLUTION.LOW,
    },
};
// ─── Loader ─────────────────────────────────────────────────────────────────
/**
 * Load SLA configuration from the database, falling back to built-in
 * defaults for any missing metric+priority combination.
 */
export async function loadSlaConfig(prisma) {
    const rows = await prisma.slaConfig.findMany();
    // Start from defaults
    const targets = structuredClone(DEFAULT_SLA_TARGETS);
    for (const row of rows) {
        const priority = row.priority;
        if (!targets[priority])
            continue;
        if (row.metric === SlaMetric.FIRST_RESPONSE) {
            targets[priority].firstResponseMinutes = row.targetMinutes;
        }
        else if (row.metric === SlaMetric.RESOLUTION) {
            targets[priority].resolutionMinutes = row.targetMinutes;
        }
    }
    return targets;
}
