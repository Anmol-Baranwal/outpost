import { ChannelType, type ThreadChannel } from 'discord.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { PlatformDiscordAdapter, InboundHandler } from '@copilotkit/outpost/shared/platforms';
import { generateTicketId } from '@copilotkit/outpost/shared';
import type { CreateJobFn } from '@copilotkit/outpost/shared';
import { config } from '../config.js';
import { isShadowMode, handleShadowThreadCreate } from '../lib/shadow-mode.js';

/** Adapter instance shared across thread-create invocations. */
const adapter = new PlatformDiscordAdapter({ token: config.discordToken });

/**
 * Wrap the queue's createJob into the signature InboundHandler expects.
 * The queue createJob is generic over JobType; InboundHandler just needs
 * (type: string, payload: { ticketId, threadId?, source }) => Promise<string>.
 */
const createJobFn: CreateJobFn = async (
    type: string,
    payload: { ticketId: string; threadId?: string; source: string },
) => {
    return createJob(
        type as Parameters<typeof createJob>[0],
        payload as Parameters<typeof createJob>[1],
    );
};

export async function handleThreadCreate(thread: ThreadChannel, newlyCreated: boolean): Promise<void> {
    if (!newlyCreated) return;

    // Only monitor threads in configured forum channels
    const parentId = thread.parentId;
    if (!parentId) return;

    // If monitoredChannelIds is configured, only track those channels.
    // If empty, monitor all channels (useful for development).
    const isMonitored =
        config.monitoredChannelIds.length === 0 ||
        config.monitoredChannelIds.includes(parentId);

    if (!isMonitored) return;

    // Only handle public/private threads (includes forum posts)
    if (
        thread.type !== ChannelType.PublicThread &&
        thread.type !== ChannelType.PrivateThread
    ) {
        return;
    }

    // In shadow mode, create the ticket silently without posting to Discord
    if (isShadowMode()) {
        const starterMessage = await thread.fetchStarterMessage();
        const content = starterMessage?.content ?? '';
        const authorTag = starterMessage?.author.tag ?? 'Unknown';
        const authorId = starterMessage?.author.id ?? '';
        const displayId = generateTicketId();
        try {
            return void await handleShadowThreadCreate(thread, displayId, content, authorTag, authorId);
        } catch (error) {
            console.error(`[Discord Bot] Shadow mode thread handling failed for thread ${thread.id}:`, error);
            return;
        }
    }

    console.log(
        `[Discord Bot] New thread created: ${thread.name} in #${thread.parent?.name ?? 'unknown'}`,
    );

    try {
        // Fetch the starter message (first message in the thread)
        const starterMessage = await thread.fetchStarterMessage();

        // Parse the raw event through the platform adapter
        const inboundMessage = adapter.parseInboundEvent({
            thread,
            starterMessage,
        });

        // Process through the shared InboundHandler
        const handler = new InboundHandler({ prisma, createJob: createJobFn });
        const result = await handler.handle(inboundMessage);

        // Post acknowledgment in the thread (Discord-specific UX)
        await adapter.postSystemMessage(
            { id: result.ticketId, sourceId: thread.id, channel: parentId, source: adapter.platform },
            `\uD83C\uDFAB Ticket ${result.displayId} created. Our AI assistant is reviewing your question...`,
        );

        console.log(`[Discord Bot] Created ticket ${result.displayId} for thread ${thread.id}`);
    } catch (error) {
        console.error(`[Discord Bot] Failed to create ticket for thread ${thread.id}:`, error);
    }
}
