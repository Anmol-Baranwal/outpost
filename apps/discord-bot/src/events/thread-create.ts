import { ChannelType, type ThreadChannel } from 'discord.js';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';
import { generateTicketId, truncate } from '@outpost/shared';
import { config } from '../config.js';

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

    console.log(
        `[Discord Bot] New thread created: ${thread.name} in #${thread.parent?.name ?? 'unknown'}`,
    );

    try {
        // Fetch the starter message (first message in the thread)
        const starterMessage = await thread.fetchStarterMessage();
        const content = starterMessage?.content ?? '';
        const authorTag = starterMessage?.author.tag ?? 'Unknown';
        const authorId = starterMessage?.author.id ?? '';

        const displayId = generateTicketId();

        // Create the ticket in the database
        const ticket = await prisma.ticket.create({
            data: {
                displayId,
                title: truncate(thread.name, 200),
                description: truncate(content, 4000),
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                source: 'DISCORD',
                sourceId: thread.id,
                sourceUrl: thread.url,
                channel: parentId,
            },
        });

        // Create the first Message record linked to the ticket
        let messageId = ticket.id;
        if (content) {
            const msg = await prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    author: `${authorTag} (${authorId})`,
                    content: truncate(content, 8000),
                    type: 'USER',
                },
            });
            messageId = msg.id;
        }

        // Enqueue an AI response job
        await createJob(JobType.GENERATE_RESPONSE, {
            ticketId: ticket.id,
            messageId,
            context: `New support thread: ${thread.name}\n\n${content}`,
        });

        // Post acknowledgment in the thread
        await thread.send(
            `\uD83C\uDFAB Ticket ${displayId} created. Our AI assistant is reviewing your question...`,
        );

        console.log(`[Discord Bot] Created ticket ${displayId} for thread ${thread.id}`);
    } catch (error) {
        console.error(`[Discord Bot] Failed to create ticket for thread ${thread.id}:`, error);
    }
}
