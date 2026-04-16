import {
    type TurnContext,
    MessageFactory,
    CardFactory,
} from 'botbuilder';
import { buildResponseCard } from '../cards/response-card.js';

export interface PostResponseOptions {
    context: TurnContext;
    ticketDisplayId: string;
    responseText: string;
    confidence: number;
}

/**
 * Posts an AI response as a threaded reply using an Adaptive Card.
 * Includes action buttons for "Issue Solved" / "Need more help"
 * and a confidence disclaimer for low-confidence responses.
 */
export async function postAiResponse(options: PostResponseOptions): Promise<void> {
    const { context, ticketDisplayId, responseText, confidence } = options;

    const card = buildResponseCard({
        ticketDisplayId,
        responseText,
        confidence,
    });

    const activity = MessageFactory.attachment(
        CardFactory.adaptiveCard(card),
    );

    await context.sendActivity(activity);
}
