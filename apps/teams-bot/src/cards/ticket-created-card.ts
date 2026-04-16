export interface TicketCreatedCardOptions {
    ticketDisplayId: string;
    title: string;
}

/**
 * Build an Adaptive Card acknowledging ticket creation.
 */
export function buildTicketCreatedCard(options: TicketCreatedCardOptions): Record<string, unknown> {
    const { ticketDisplayId, title } = options;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: `\uD83C\uDFAB Ticket ${ticketDisplayId} created`,
                weight: 'Bolder',
                size: 'Medium',
            },
            {
                type: 'TextBlock',
                text: title,
                wrap: true,
                isSubtle: true,
            },
            {
                type: 'TextBlock',
                text: 'Our AI assistant is reviewing your question...',
                wrap: true,
            },
        ],
    };
}
