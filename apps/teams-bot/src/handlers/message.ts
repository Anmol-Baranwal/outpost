import { type TurnContext, CardFactory, MessageFactory } from 'botbuilder';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { truncate } from '@copilotkit/outpost/shared';
import { InboundHandler, TeamsAdapter } from '@copilotkit/outpost/shared/platforms';
import type { InboundPrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import { buildTicketCreatedCard } from '../cards/ticket-created-card.js';
import { config } from '../config.js';

/**
 * Create the shared InboundHandler with all required dependencies.
 */
function createInboundHandler(): InboundHandler {
    return new InboundHandler({
        prisma: prisma as unknown as InboundPrismaLike,
        createJob: createJob as unknown as CreateJobFn,
    });
}

/**
 * Create the TeamsAdapter from bot config.
 */
function createTeamsAdapter(): TeamsAdapter {
    return new TeamsAdapter({
        appId: config.teamsAppId,
        appPassword: config.teamsAppPassword,
        tenantId: config.teamsTenantId || undefined,
    });
}

const teamsAdapter = createTeamsAdapter();
const inboundHandler = createInboundHandler();

/**
 * Handle incoming messages from Teams channels.
 *
 * Delegates to TeamsAdapter for parsing and InboundHandler for common
 * ticket creation / follow-up logic. Teams-specific concerns (channel
 * monitoring, Adaptive Card acknowledgment) remain here.
 */
export async function handleMessage(context: TurnContext): Promise<void> {
    const activity = context.activity;

    // Filter non-message activities and bot self-messages
    if (activity.type !== 'message') return;
    if (activity.from?.id === activity.recipient?.id) return;

    // Parse through adapter
    const message = teamsAdapter.parseInboundEvent(activity);
    if (!message || !message.content) return;

    try {
        // Channel monitoring filter applies to both thread starts and replies.
        // If the list is empty, monitor all channels (including 1:1 chats);
        // otherwise the activity must carry an explicitly monitored channel ID.
        const channelId = message.channelId;
        const isMonitored =
            config.monitoredChannelIds.length === 0 ||
            (channelId !== undefined && config.monitoredChannelIds.includes(channelId));

        if (!isMonitored) return;

        // Delegate to the shared inbound handler
        const result = await inboundHandler.handle(message);

        // An orphaned reply also reports isNewTicket: true — a ticket really was
        // created — but it is NOT a conversation Outpost opened. Teams sets
        // isThreadStart from `!activity.replyToId`, so a bare mid-conversation
        // message ("thanks, that worked!") whose thread we have no ticket for
        // lands here. Acking it would post "🎫 We've got your question" into a
        // thread we were never part of, and storing the conversationReference
        // would claim that thread for proactive messaging. Both are skipped; the
        // ticket still exists for a human to pick up from the dashboard.
        if (result.isNewTicket && !result.isOrphanedReply) {
            // Store Teams-specific ConversationReference for proactive messaging
            const conversationReference = {
                serviceUrl: activity.serviceUrl ?? 'https://smba.trafficmanager.net/teams/',
                conversationId: activity.conversation.id,
                botId: activity.recipient.id,
            };
            await prisma.ticket.update({
                where: { id: result.ticketId },
                data: {
                    additionalInfo: { conversationReference },
                },
            });

            // New ticket: post acknowledgment card.
            //
            // Teams is deliberately the only platform that still acknowledges.
            // Discord, Slack and the GitHub App dropped their ack posts because
            // those were plain text that printed the internal ticket displayId
            // into a public channel and gave the reporter nothing to act on.
            // Neither objection applies here: buildTicketCreatedCard carries no
            // displayId (see apps/teams-bot/src/cards/ticket-created-card.ts,
            // asserted by cards.test.ts) and an Adaptive Card is a richer surface
            // than a plain text post — it tells the reporter which of the two
            // things is about to happen, an AI answer or a human follow-up, off
            // result.aiJobEnqueued. Known divergence, not an oversight; if the
            // card ever starts rendering an identifier, drop this the way the
            // other platforms did.
            const card = buildTicketCreatedCard({
                title: truncate(message.content, 200),
            });

            const reply = MessageFactory.attachment(
                CardFactory.adaptiveCard(card),
            );

            await context.sendActivity(reply);

            console.log(
                `[Teams Bot] Created ticket ${result.displayId} for conversation ${message.threadId}`,
            );
        } else if (result.isOrphanedReply) {
            console.log(
                `[Teams Bot] Untracked mid-conversation message from ${message.platformUsername} filed as ticket ${result.displayId} (no ack card, no conversation reference)`,
            );
        } else {
            console.log(
                `[Teams Bot] Message from ${message.platformUsername} appended to ticket ${result.displayId}`,
            );
        }
    } catch (error) {
        console.error(
            `[Teams Bot] Failed to process message in conversation ${message.threadId}:`,
            error,
        );
    }
}
