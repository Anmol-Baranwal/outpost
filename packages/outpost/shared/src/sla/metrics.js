/**
 * SLA metrics aggregator.
 *
 * Produces dashboard-ready aggregate statistics about SLA performance
 * over a given date range, including breach counts, average response
 * times, breach rates by priority, and period-over-period trends.
 */
import { TicketPriority } from '../types.js';
import { loadSlaConfig } from './config.js';
import { checkSlaCompliance } from './checker.js';
// ─── Aggregator ─────────────────────────────────────────────────────────────
/**
 * Compute aggregate SLA metrics for the given date range.
 *
 * When no dateRange is supplied the aggregator uses the last 30 days
 * as the current period and the 30 days before that as the comparison
 * period.
 */
export async function getSlaMetrics(prisma, dateRange) {
    const now = new Date();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const currentRange = dateRange ?? {
        from: new Date(now.getTime() - thirtyDaysMs),
        to: now,
    };
    const periodLengthMs = currentRange.to.getTime() - currentRange.from.getTime();
    const previousRange = {
        from: new Date(currentRange.from.getTime() - periodLengthMs),
        to: currentRange.from,
    };
    const targets = await loadSlaConfig(prisma);
    // Fetch current period tickets with messages
    const currentTickets = await fetchTicketsInRange(prisma, currentRange);
    const previousTickets = await fetchTicketsInRange(prisma, previousRange);
    // Evaluate current period
    const currentResults = currentTickets.map((t) => checkSlaCompliance(t, targets, currentRange.to));
    const previousResults = previousTickets.map((t) => checkSlaCompliance(t, targets, previousRange.to));
    // Aggregate
    const totalTickets = currentResults.length;
    const totalBreaches = currentResults.filter((r) => r.firstResponseBreached || r.resolutionBreached).length;
    const firstResponseTimes = currentResults
        .map((r) => r.firstResponseTimeMs)
        .filter((ms) => ms !== null);
    const resolutionTimes = currentResults
        .map((r) => r.resolutionTimeMs)
        .filter((ms) => ms !== null);
    const avgFirstResponseTimeMs = firstResponseTimes.length > 0
        ? firstResponseTimes.reduce((a, b) => a + b, 0) / firstResponseTimes.length
        : null;
    const avgResolutionTimeMs = resolutionTimes.length > 0
        ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
        : null;
    // Breach rate by priority
    const breachRateByPriority = buildBreachRateByPriority(currentResults);
    // Trend
    const previousBreaches = previousResults.filter((r) => r.firstResponseBreached || r.resolutionBreached).length;
    return {
        totalTickets,
        totalBreaches,
        avgFirstResponseTimeMs,
        avgResolutionTimeMs,
        breachRateByPriority,
        trend: {
            currentBreaches: totalBreaches,
            previousBreaches,
            delta: totalBreaches - previousBreaches,
        },
    };
}
// ─── Helpers ────────────────────────────────────────────────────────────────
async function fetchTicketsInRange(prisma, range) {
    return prisma.ticket.findMany({
        where: {
            createdAt: {
                gte: range.from,
                lte: range.to,
            },
        },
        include: {
            messages: {
                select: {
                    type: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
}
function buildBreachRateByPriority(results) {
    const priorities = [
        TicketPriority.CRITICAL,
        TicketPriority.HIGH,
        TicketPriority.MEDIUM,
        TicketPriority.LOW,
    ];
    return priorities.map((priority) => {
        const matching = results.filter((r) => r.priority === priority);
        const breached = matching.filter((r) => r.firstResponseBreached || r.resolutionBreached);
        return {
            priority,
            total: matching.length,
            breached: breached.length,
            rate: matching.length > 0 ? breached.length / matching.length : 0,
        };
    });
}
