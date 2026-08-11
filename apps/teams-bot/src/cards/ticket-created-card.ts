export interface TicketCreatedCardOptions {
    title: string;
}

/**
 * Build an Adaptive Card acknowledging ticket creation.
 *
 * Deliberately carries no ticket displayId. That identifier is internal — it
 * belongs in the dashboard and team slash commands, not in reporter-facing copy.
 */
export function buildTicketCreatedCard(options: TicketCreatedCardOptions): Record<string, unknown> {
    const { title } = options;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: "\uD83C\uDFAB We've got your question",
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
