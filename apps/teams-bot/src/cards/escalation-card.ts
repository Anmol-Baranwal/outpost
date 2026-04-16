export interface EscalationCardOptions {
    ticketDisplayId: string;
    reason: string;
}

/**
 * Build an Adaptive Card for escalation notifications.
 */
export function buildEscalationCard(options: EscalationCardOptions): Record<string, unknown> {
    const { ticketDisplayId, reason } = options;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: `\u26A0\uFE0F Escalation - ${ticketDisplayId}`,
                weight: 'Bolder',
                size: 'Medium',
                color: 'Warning',
            },
            {
                type: 'TextBlock',
                text: reason,
                wrap: true,
            },
            {
                type: 'TextBlock',
                text: 'A team member has been notified and will follow up shortly.',
                wrap: true,
                isSubtle: true,
            },
        ],
    };
}
