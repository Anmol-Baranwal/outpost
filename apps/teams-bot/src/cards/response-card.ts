export interface ResponseCardOptions {
    responseText: string;
    confidence: number;
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Build an Adaptive Card JSON for an AI response.
 * Includes action buttons and an optional low-confidence disclaimer.
 *
 * Carries no ticket identifier anywhere — not in card text and not in the
 * `Action.Submit` `data` payloads. The whole card, `data` included, ships to
 * the reporter's Teams client, and the identifier is internal to the dashboard
 * and team slash commands. Nothing needs it here either: the button handlers in
 * `../handlers/card-actions.ts` resolve the ticket from
 * `context.activity.conversation.id`, so the only field the payload has to
 * carry is `action`.
 *
 * Reachability: this module is currently unreachable in production. Its only
 * importer is `../lib/teams-poster.ts`, which nothing imports; the worker posts
 * AI responses through `PlatformTeamsAdapter.buildResponseCard` in
 * `packages/outpost/shared/src/platforms/teams.ts` instead. Kept and kept
 * correct rather than deleted.
 */
export function buildResponseCard(options: ResponseCardOptions): Record<string, unknown> {
    const { responseText, confidence } = options;

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
                },
            },
            {
                type: 'Action.Submit',
                title: 'Need more help',
                data: {
                    action: 'need_more_help',
                },
            },
        ],
    };
}
