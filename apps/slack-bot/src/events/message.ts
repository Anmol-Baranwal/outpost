import type { App } from '@slack/bolt';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { SlackAdapter, InboundHandler } from '@copilotkit/outpost/shared/platforms';
import type { InboundPrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import { config } from '../config.js';

/**
 * Register the Slack message event handler.
 *
 * Delegates to SlackAdapter (event parsing, message posting) and
 * InboundHandler (ticket creation, message appending, job enqueuing)
 * so the bot stays thin and the logic is reusable across platforms.
 */
export function registerMessageHandler(app: App): void {
    const adapter = new SlackAdapter({
        token: config.slackBotToken,
    });

    const handler = new InboundHandler({
        prisma: prisma as unknown as InboundPrismaLike,
        createJob: createJob as unknown as CreateJobFn,
    });

    app.event('message', async ({ event }) => {
        try {
            // Filter bot messages and message subtypes (edits, deletions, etc.)
            const rawEvent = event as unknown as Record<string, unknown>;
            if (rawEvent.bot_id || rawEvent.subtype) return;

            const message = adapter.parseInboundEvent(event);
            if (!message || !message.content) return;

            // Filter unmonitored channels for new top-level messages
            if (message.isThreadStart && config.monitoredChannelIds?.length) {
                if (!config.monitoredChannelIds.includes(message.channelId ?? '')) return;
            }

            // For threaded replies, ignore if the thread isn't tracked as a ticket.
            // This prevents InboundHandler from creating a new ticket for stray replies.
            if (!message.isThreadStart) {
                const sourceId = message.channelId
                    ? `${message.channelId}:${message.threadId}`
                    : message.threadId ?? '';
                const existingTicket = await prisma.ticket.findFirst({
                    where: { source: 'SLACK', sourceId },
                });
                if (!existingTicket) return;
            }

            await handler.handle(message);

            // No acknowledgment post \u2014 it leaked the internal ticket displayId to
            // the channel and added a second bot message for no reporter benefit.
            // See the matching change in apps/discord-bot/src/events/thread-create.ts.
        } catch (error) {
            console.error(
                `[Slack Bot] Failed to process message in channel ${(event as { channel?: string }).channel ?? 'unknown'}:`,
                error,
            );
        }
    });
}
