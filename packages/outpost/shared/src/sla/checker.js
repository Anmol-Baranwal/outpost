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
import { SlaMetric } from '../types.js';
// ─── Checker ────────────────────────────────────────────────────────────────
/**
 * Evaluate a single ticket's SLA compliance.
 *
 * @param ticket  The ticket with its messages loaded.
 * @param targets Complete priority→target map (from loadSlaConfig).
 * @param now     Optional "current time" override for testing.
 */
export function checkSlaCompliance(ticket, targets, now = new Date()) {
    const priority = ticket.priority;
    const target = targets[priority];
    // ── First response time ─────────────────────────────────────────────
    const firstTeamMessage = ticket.messages
        .filter((m) => m.type === 'BOT' || m.type === 'SYSTEM')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    const firstResponseTimeMs = firstTeamMessage
        ? firstTeamMessage.createdAt.getTime() - ticket.createdAt.getTime()
        : null;
    const firstResponseTargetMs = target.firstResponseMinutes * 60 * 1000;
    const firstResponseBreached = firstResponseTimeMs !== null
        ? firstResponseTimeMs > firstResponseTargetMs
        : (now.getTime() - ticket.createdAt.getTime()) > firstResponseTargetMs;
    // ── Resolution time ─────────────────────────────────────────────────
    const isClosed = ticket.status === 'CLOSED' || ticket.status === 'RESOLVED';
    // Both CLOSED and RESOLVED are treated as terminal states for resolution
    // SLA.  We don't have an explicit closedAt field; updatedAt would
    // approximate it but isn't used here — we measure elapsed time from
    // creation to now, which overestimates slightly for already-closed
    // tickets.  For open tickets we check elapsed time so far.
    const resolutionTimeMs = isClosed
        ? now.getTime() - ticket.createdAt.getTime()
        : null;
    const resolutionTargetMs = target.resolutionMinutes * 60 * 1000;
    const elapsedMs = now.getTime() - ticket.createdAt.getTime();
    const resolutionBreached = isClosed
        ? (resolutionTimeMs ?? 0) > resolutionTargetMs
        : elapsedMs > resolutionTargetMs;
    return {
        ticketId: ticket.id,
        priority,
        firstResponseBreached,
        resolutionBreached,
        firstResponseTimeMs,
        resolutionTimeMs,
        target,
    };
}
/**
 * Build breach events for a check result, returning only the metrics
 * that are actually breached.
 */
export function buildBreachEvents(result, ticket, now = new Date()) {
    const events = [];
    if (result.firstResponseBreached) {
        // Use measured first-response time if available, otherwise calculate from ticket creation
        let elapsed = result.firstResponseTimeMs;
        if (elapsed == null && ticket) {
            elapsed = now.getTime() - ticket.createdAt.getTime();
        }
        if (elapsed != null) {
            events.push({
                ticketId: result.ticketId,
                metric: SlaMetric.FIRST_RESPONSE,
                priority: result.priority,
                elapsedMs: elapsed,
                targetMs: result.target.firstResponseMinutes * 60 * 1000,
            });
        }
    }
    if (result.resolutionBreached) {
        // Use measured resolution time if available, otherwise calculate from ticket creation
        let elapsed = result.resolutionTimeMs;
        if (elapsed == null && ticket) {
            elapsed = now.getTime() - ticket.createdAt.getTime();
        }
        if (elapsed != null) {
            events.push({
                ticketId: result.ticketId,
                metric: SlaMetric.RESOLUTION,
                priority: result.priority,
                elapsedMs: elapsed,
                targetMs: result.target.resolutionMinutes * 60 * 1000,
            });
        }
    }
    return events;
}
