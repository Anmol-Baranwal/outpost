/**
 * SLA metrics aggregator.
 *
 * Produces dashboard-ready aggregate statistics about SLA performance
 * over a given date range, including breach counts, average response
 * times, breach rates by priority, and period-over-period trends.
 */
import { TicketPriority } from '../types.js';
import type { SlaConfigClient } from './config.js';
import type { TicketForSla } from './checker.js';
export interface DateRange {
    from: Date;
    to: Date;
}
export interface PriorityBreachRate {
    priority: TicketPriority;
    total: number;
    breached: number;
    rate: number;
}
export interface SlaMetricsResult {
    /** Total tickets evaluated. */
    totalTickets: number;
    /** Total breach count (first-response OR resolution). */
    totalBreaches: number;
    /** Average first-response time in ms across tickets that have one. */
    avgFirstResponseTimeMs: number | null;
    /** Average resolution time in ms across closed tickets. */
    avgResolutionTimeMs: number | null;
    /** Breach rate broken down by priority. */
    breachRateByPriority: PriorityBreachRate[];
    /** Trend comparing this period's breach count vs the previous equal-length period. */
    trend: {
        currentBreaches: number;
        previousBreaches: number;
        /** Positive = more breaches this period, negative = fewer. */
        delta: number;
    };
}
export interface SlaMetricsClient extends SlaConfigClient {
    ticket: {
        findMany: (args: {
            where: {
                createdAt: {
                    gte: Date;
                    lte: Date;
                };
            };
            include: {
                messages: {
                    select: {
                        type: true;
                        createdAt: true;
                    };
                    orderBy: {
                        createdAt: 'asc';
                    };
                };
            };
        }) => Promise<TicketForSla[]>;
    };
}
/**
 * Compute aggregate SLA metrics for the given date range.
 *
 * When no dateRange is supplied the aggregator uses the last 30 days
 * as the current period and the 30 days before that as the comparison
 * period.
 */
export declare function getSlaMetrics(prisma: SlaMetricsClient, dateRange?: DateRange): Promise<SlaMetricsResult>;
//# sourceMappingURL=metrics.d.ts.map