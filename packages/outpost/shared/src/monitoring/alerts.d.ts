/**
 * Alert detection for SLA breaches and bot failures.
 *
 * Stub implementation: logs alerts via the structured logger.
 * In production, swap the handler for Slack webhook or PagerDuty.
 */
export type AlertSeverity = 'warning' | 'critical';
export interface Alert {
    severity: AlertSeverity;
    title: string;
    service: string;
    details: string;
    timestamp: string;
}
export type AlertHandler = (alert: Alert) => void | Promise<void>;
export interface AlertManagerOptions {
    service: string;
    handler?: AlertHandler;
}
export declare class AlertManager {
    private logger;
    private handler;
    constructor(options: AlertManagerOptions);
    /**
     * Fire an alert for an SLA breach.
     */
    slaBreached(details: {
        ticketId: string;
        priority: string;
        breachType: 'first_response' | 'resolution';
        elapsedMinutes: number;
        targetMinutes: number;
    }): void;
    /**
     * Fire an alert for a bot failure (Discord or GitHub app crash/error).
     */
    botFailure(details: {
        bot: 'discord' | 'github';
        error: string;
        context?: string;
    }): void;
    /**
     * Core fire method — builds an Alert and dispatches it.
     */
    fire(alert: Omit<Alert, 'timestamp'>): void;
}
export declare function createAlertManager(service: string, handler?: AlertHandler): AlertManager;
//# sourceMappingURL=alerts.d.ts.map