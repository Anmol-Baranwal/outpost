export interface EscalationCardOptions {
    reason: string;
}

/**
 * Build an Adaptive Card for escalation notifications.
 *
 * Carries no ticket displayId — this card is shown to the reporter, and the
 * identifier is internal to the dashboard and team slash commands.
 */
export function buildEscalationCard(options: EscalationCardOptions): Record<string, unknown> {
    const { reason } = options;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: '\u26A0\uFE0F Escalated',
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
