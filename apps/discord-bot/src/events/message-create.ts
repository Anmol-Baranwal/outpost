import { ChannelType, type Message } from 'discord.js';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';
import { truncate } from '@outpost/shared';
import { findTicketByThreadId, isTeamMember } from '../lib/tickets.js';

export async function handleMessageCreate(message: Message): Promise<void> {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Only process messages in threads (forum posts are threads)
    if (
        message.channel.type !== ChannelType.PublicThread &&
        message.channel.type !== ChannelType.PrivateThread
    ) {
        return;
    }

    const threadId = message.channel.id;

    try {
        // Look up the ticket associated with this thread
        const ticket = await findTicketByThreadId(threadId);
        if (!ticket) {
            // This thread isn't tracked as a ticket, ignore it
            return;
        }

        // Append the message as a Message record on the ticket
        const savedMessage = await prisma.message.create({
            data: {
                ticketId: ticket.id,
                author: `${message.author.tag} (${message.author.id})`,
                content: truncate(message.content, 8000),
                type: 'USER',
            },
        });

        console.log(
            `[Discord Bot] Message from ${message.author.tag} appended to ticket ${ticket.displayId}`,
        );

        // Check if this user is a team member
        const teamMember = await isTeamMember(message.author.id);

        if (teamMember) {
            // Team member message: don't enqueue AI response, but update ticket status
            // if it was waiting on the team
            if (ticket.status === 'WAITING_ON_TEAM') {
                await prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { status: 'WAITING_ON_CUSTOMER' },
                });
            }
        } else {
            // Original poster or other user: enqueue a new AI response for follow-up
            await createJob(JobType.AI_RESPONSE, {
                ticketId: ticket.id,
                threadId,
                source: 'discord' as const,
            });

            // Update ticket status if it was waiting on customer
            if (ticket.status === 'WAITING_ON_CUSTOMER' || ticket.status === 'RESOLVED') {
                await prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { status: 'OPEN' },
                });
            }
        }
    } catch (error) {
        console.error(
            `[Discord Bot] Failed to process message in thread ${threadId}:`,
            error,
        );
    }
}
