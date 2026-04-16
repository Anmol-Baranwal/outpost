/**
 * SLA compliance checker.
 *
 * Evaluates a single ticket (with its messages) against the SLA targets
 * for its priority level.
 *
 * First-response time = time between ticket creation and the first
 * BOT or SYSTEM message (bot/system activity, treated as initial response
 * for SLA purposes).  If no such message exists the ticket is considered
 * "awaiting first response" and is breached only when the elapsed time
 * exceeds the target.
 *
 * Resolution time = time between ticket creation and status=CLOSED.
 * Open tickets are checked against the target based on elapsed time so far.
 */
import type { SlaCheckResult, SlaBreachEvent, SlaTargetMap } from './config.js';
export interface TicketForSla {
    id: string;
    priority: string;
    status: string;
    slaBreachedAt: Date | null;
    createdAt: Date;
    messages: Array<{
        type: string;
        createdAt: Date;
    }>;
}
/**
 * Evaluate a single ticket's SLA compliance.
 *
 * @param ticket  The ticket with its messages loaded.
 * @param targets Complete priority→target map (from loadSlaConfig).
 * @param now     Optional "current time" override for testing.
 */
export declare function checkSlaCompliance(ticket: TicketForSla, targets: SlaTargetMap, now?: Date): SlaCheckResult;
/**
 * Build breach events for a check result, returning only the metrics
 * that are actually breached.
 */
export declare function buildBreachEvents(result: SlaCheckResult, ticket?: TicketForSla, now?: Date): SlaBreachEvent[];
//# sourceMappingURL=checker.d.ts.map