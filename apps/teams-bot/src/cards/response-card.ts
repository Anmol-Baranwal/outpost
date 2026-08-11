export interface ResponseCardOptions {
    /**
     * Internal ticket identifier. Routed through the Action.Submit `data`
     * payloads so button clicks resolve back to the ticket — never rendered
     * into card text, which the reporter reads.
     */
    ticketDisplayId: string;
    responseText: string;
    confidence: number;
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Build an Adaptive Card JSON for an AI response.
 * Includes action buttons and an optional low-confidence disclaimer.
 */
export function buildResponseCard(options: ResponseCardOptions): Record<string, unknown> {
    const { ticketDisplayId, responseText, confidence } = options;

    const body: Record<string, unknown>[] = [
        {
            type: 'TextBlock',
            text: 'AI Response',
            weight: 'Bolder',
            size: 'Medium',
        },
        {
            type: 'TextBlock',
            text: responseText,
            wrap: true,
        },
    ];

    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
        body.push({
            type: 'TextBlock',
            text: '_This response has lower confidence. A team member may follow up._',
            wrap: true,
            isSubtle: true,
            size: 'Small',
        });
    }

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body,
        actions: [
            {
                type: 'Action.Submit',
                title: 'Issue Solved',
                data: {
                    action: 'issue_solved',
                    ticketDisplayId,
                },
            },
            {
                type: 'Action.Submit',
                title: 'Need more help',
                data: {
                    action: 'need_more_help',
                    ticketDisplayId,
                },
            },
        ],
    };
}
