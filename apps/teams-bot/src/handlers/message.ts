import { type TurnContext, CardFactory, MessageFactory } from 'botbuilder';
import { prisma } from '@copilotkit/outpost-db';
import { createJob, JobType } from '@copilotkit/outpost-queue';
import { generateTicketId, truncate } from '@copilotkit/outpost-shared';
import { findTicketByConversationId, isTeamMember } from '../lib/tickets.js';
import { buildTicketCreatedCard } from '../cards/ticket-created-card.js';
import { config } from '../config.js';

/**
 * Build a Teams deep link for a conversation.
 */
function buildTeamsDeepLink(conversationId: string): string {
    const tenantId = config.teamsTenantId;
    if (tenantId) {
        return `https://teams.microsoft.com/l/message/${conversationId}?tenantId=${tenantId}`;
    }
    return `https://teams.microsoft.com/l/message/${conversationId}`;
}

/**
 * Handle incoming messages from Teams channels.
 *
 * - New messages in monitored channels create a ticket
 * - Follow-up messages in tracked conversations append to existing ticket
 */
export async function handleMessage(context: TurnContext): Promise<void> {
    const activity = context.activity;

    // Only handle message activities
    if (activity.type !== 'message') return;

    // Ignore messages from the bot itself
    if (activity.from.id === activity.recipient.id) return;

    const conversationId = activity.conversation.id;
    const channelId = activity.channelData?.teamsChannelId as string | undefined;
    const content = activity.text ?? '';
    const authorName = activity.from.name ?? 'Unknown';
    const authorId = activity.from.aadObjectId ?? activity.from.id;
    const replyToId = activity.replyToId;

    try {
        // Check if this conversation already has a ticket
        const existingTicket = await findTicketByConversationId(conversationId);

        if (existingTicket) {
            // Follow-up message: append to existing ticket
            await handleFollowUp(context, existingTicket, {
                authorName,
                authorId,
                content,
                conversationId,
            });
        } else if (!replyToId) {
            // New top-level message: create a ticket
            // If monitoredChannelIds is configured, only track those channels.
            // If empty, monitor all channels (useful for development).
            const isMonitored =
                config.monitoredChannelIds.length === 0 ||
                (channelId !== undefined && config.monitoredChannelIds.includes(channelId));

            if (!isMonitored) return;

            await handleNewMessage(context, {
                authorName,
                authorId,
                content,
                conversationId,
                channelId: channelId ?? '',
            });
        }
    } catch (error) {
        console.error(
            `[Teams Bot] Failed to process message in conversation ${conversationId}:`,
            error,
        );
    }
}

interface NewMessageParams {
    authorName: string;
    authorId: string;
    content: string;
    conversationId: string;
    channelId: string;
}

async function handleNewMessage(
    context: TurnContext,
    params: NewMessageParams,
): Promise<void> {
    const { authorName, authorId, content, conversationId, channelId } = params;

    const displayId = generateTicketId();
    const sourceUrl = buildTeamsDeepLink(conversationId);

    // Create the ticket in the database
    const ticket = await prisma.ticket.create({
        data: {
            displayId,
            title: truncate(content, 200),
            description: truncate(content, 4000),
            status: 'OPEN',
            priority: 'MEDIUM',
            type: 'QUESTION',
            source: 'TEAMS',
            sourceId: conversationId,
            sourceUrl,
            channel: channelId,
        },
    });

    // Create the first Message record linked to the ticket
    if (content) {
        await prisma.message.create({
            data: {
                ticketId: ticket.id,
                author: `${authorName} (${authorId})`,
                content: truncate(content, 8000),
                type: 'USER',
            },
        });
    }

    // Enqueue an AI response job
    await createJob(JobType.AI_RESPONSE, {
        ticketId: ticket.id,
        threadId: conversationId,
        source: 'teams' as const,
    });

    // Post acknowledgment card
    const card = buildTicketCreatedCard({
        ticketDisplayId: displayId,
        title: truncate(content, 200),
    });

    const reply = MessageFactory.attachment(
        CardFactory.adaptiveCard(card),
    );

    await context.sendActivity(reply);

    console.log(`[Teams Bot] Created ticket ${displayId} for conversation ${conversationId}`);
}

interface FollowUpParams {
    authorName: string;
    authorId: string;
    content: string;
    conversationId: string;
}

async function handleFollowUp(
    context: TurnContext,
    ticket: { id: string; displayId: string; status: string },
    params: FollowUpParams,
): Promise<void> {
    const { authorName, authorId, content, conversationId } = params;

    // Append the message as a Message record on the ticket
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${authorName} (${authorId})`,
            content: truncate(content, 8000),
            type: 'USER',
        },
    });

    console.log(
        `[Teams Bot] Message from ${authorName} appended to ticket ${ticket.displayId}`,
    );

    // Check if this user is a team member
    const teamMemberResult = await isTeamMember(authorId);

    if (teamMemberResult) {
        // Team member message: update ticket status if waiting on team
        if (ticket.status === 'WAITING_ON_TEAM') {
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: { status: 'WAITING_ON_CUSTOMER' },
            });
        }
    } else {
        // External user: enqueue a new AI response
        await createJob(JobType.AI_RESPONSE, {
            ticketId: ticket.id,
            threadId: conversationId,
            source: 'teams' as const,
        });

        // Reopen ticket if it was waiting on customer or resolved
        if (ticket.status === 'WAITING_ON_CUSTOMER' || ticket.status === 'RESOLVED') {
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: { status: 'OPEN' },
            });
        }
    }
}
