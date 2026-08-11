import { type TurnContext, CardFactory, MessageFactory } from 'botbuilder';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { findTicketByConversationId } from '../lib/tickets.js';
import { buildEscalationCard } from '../cards/escalation-card.js';

/**
 * Submit payload from an Adaptive Card button. Only `action` is sent — the
 * cards deliberately carry no ticket identifier, and the handlers below resolve
 * the ticket from the conversation id instead.
 */
interface CardActionData {
    action: string;
}

/**
 * Handle Adaptive Card submit actions from Teams.
 * Dispatches to the appropriate handler based on the action field.
 */
export async function handleCardAction(context: TurnContext): Promise<void> {
    const activity = context.activity;
    const data = activity.value as CardActionData | undefined;

    if (!data?.action) return;

    const handlers: Record<string, (ctx: TurnContext, d: CardActionData) => Promise<void>> = {
        issue_solved: handleIssueSolved,
        need_more_help: handleNeedMoreHelp,
    };

    const handler = handlers[data.action];
    if (handler) {
        try {
            await handler(context, data);
        } catch (error) {
            console.error(`[Teams Bot] Error handling card action ${data.action}:`, error);
            await context.sendActivity('An error occurred while processing your request.');
        }
    }
}

async function handleIssueSolved(context: TurnContext, _data: CardActionData): Promise<void> {
    const conversationId = context.activity.conversation.id;
    const ticket = await findTicketByConversationId(conversationId);

    if (!ticket) {
        await context.sendActivity('No ticket found for this conversation.');
        return;
    }

    const authorName = context.activity.from.name ?? 'Unknown';
    const authorId = context.activity.from.aadObjectId ?? context.activity.from.id;

    // Update ticket status to CLOSED
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED' },
    });

    // Log the resolution as a system message
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${authorName} (${authorId})`,
            content: 'Issue marked as solved by user.',
            type: 'SYSTEM',
        },
    });

    await context.sendActivity('Glad we could help! \uD83C\uDF89');

    console.log(`[Teams Bot] Ticket ${ticket.displayId} closed via "Issue Solved" button`);
}

async function handleNeedMoreHelp(context: TurnContext, _data: CardActionData): Promise<void> {
    const conversationId = context.activity.conversation.id;
    const ticket = await findTicketByConversationId(conversationId);

    if (!ticket) {
        await context.sendActivity('No ticket found for this conversation.');
        return;
    }

    const authorName = context.activity.from.name ?? 'Unknown';
    const authorId = context.activity.from.aadObjectId ?? context.activity.from.id;

    // Update ticket to waiting on team
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'WAITING_ON_TEAM' },
    });

    // Enqueue an escalation notification
    await createJob(JobType.ESCALATION, {
        ticketId: ticket.id,
        reason: `User requested more help via "Need more help" button in Teams conversation ${conversationId}`,
    });

    // Log the escalation
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${authorName} (${authorId})`,
            content: 'User requested more help. Escalating to team.',
            type: 'SYSTEM',
        },
    });

    // Post escalation card
    const card = buildEscalationCard({
        reason: 'User requested additional assistance.',
    });

    const reply = MessageFactory.attachment(
        CardFactory.adaptiveCard(card),
    );

    await context.sendActivity(reply);

    console.log(`[Teams Bot] Ticket ${ticket.displayId} escalated via "Need more help" button`);
}
