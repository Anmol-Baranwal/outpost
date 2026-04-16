/**
 * Alert detection for SLA breaches and bot failures.
 *
 * Stub implementation: logs alerts via the structured logger.
 * In production, swap the handler for Slack webhook or PagerDuty.
 */

import { createLogger, type Logger } from './logger.js';

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
    severity: AlertSeverity;
    title: string;
    service: string;
    details: string;
    timestamp: string;
}

export type AlertHandler = (alert: Alert) => void | Promise<void>;

/**
 * Default handler — writes to structured log as a fallback.
 */
function logAlertHandler(alert: Alert, logger: Logger): void {
    const meta = {
        alertSeverity: alert.severity,
        alertTitle: alert.title,
        alertService: alert.service,
        alertDetails: alert.details,
    };

    if (alert.severity === 'critical') {
        logger.fatal(alert.title, meta);
    } else {
        logger.warn(alert.title, meta);
    }
}

export interface AlertManagerOptions {
    service: string;
    handler?: AlertHandler;
}

export class AlertManager {
    private logger: Logger;
    private handler: AlertHandler;

    constructor(options: AlertManagerOptions) {
        this.logger = createLogger(options.service);
        this.handler = options.handler ?? ((alert) => logAlertHandler(alert, this.logger));
    }

    /**
     * Fire an alert for an SLA breach.
     */
    slaBreached(details: {
        ticketId: string;
        priority: string;
        breachType: 'first_response' | 'resolution';
        elapsedMinutes: number;
        targetMinutes: number;
    }): void {
        const severity: AlertSeverity =
            details.elapsedMinutes > details.targetMinutes * 2 ? 'critical' : 'warning';

        this.fire({
            severity,
            title: `SLA breach: ${details.breachType} for ${details.priority} ticket`,
            service: 'sla-monitor',
            details: `Ticket ${details.ticketId} — elapsed ${details.elapsedMinutes}m vs target ${details.targetMinutes}m`,
        });
    }

    /**
     * Fire an alert for a bot failure (Discord or GitHub app crash/error).
     */
    botFailure(details: {
        bot: 'discord' | 'github';
        error: string;
        context?: string;
    }): void {
        this.fire({
            severity: 'critical',
            title: `${details.bot} bot failure`,
            service: `${details.bot}-bot`,
            details: `${details.error}${details.context ? ` — ${details.context}` : ''}`,
        });
    }

    /**
     * Core fire method — builds an Alert and dispatches it.
     */
    fire(alert: Omit<Alert, 'timestamp'>): void {
        const fullAlert: Alert = {
            ...alert,
            timestamp: new Date().toISOString(),
        };
        this.handler(fullAlert);
    }
}

export function createAlertManager(service: string, handler?: AlertHandler): AlertManager {
    return new AlertManager({ service, handler });
}
