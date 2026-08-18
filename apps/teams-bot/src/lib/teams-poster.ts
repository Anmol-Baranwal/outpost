import {
    type TurnContext,
    MessageFactory,
    CardFactory,
} from 'botbuilder';
import { buildResponseCard } from '../cards/response-card.js';

export interface PostResponseOptions {
    context: TurnContext;
    responseText: string;
    confidence: number;
}

/**
 * Posts an AI response as a threaded reply using an Adaptive Card.
 * Includes action buttons for "Issue Solved" / "Need more help"
 * and a confidence disclaimer for low-confidence responses.
 *
 * Takes no ticket identifier: the card carries none (see
 * `../cards/response-card.ts`) and the reply is threaded by the Bot Framework
 * conversation, which is also how the button handlers find the ticket again.
 *
 * Reachability: nothing imports this module. The worker posts AI responses via
 * `PlatformTeamsAdapter` in `packages/outpost/shared/src/platforms/teams.ts`.
 */
export async function postAiResponse(options: PostResponseOptions): Promise<void> {
    const { context, responseText, confidence } = options;

    const card = buildResponseCard({
        responseText,
        confidence,
    });

    const activity = MessageFactory.attachment(
        CardFactory.adaptiveCard(card),
    );

    await context.sendActivity(activity);
}
