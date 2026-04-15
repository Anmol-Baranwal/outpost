import { ChannelType, type ButtonInteraction } from 'discord.js';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';
import { findTicketByThreadId } from '../lib/tickets.js';

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const handlers: Record<string, (i: ButtonInteraction) => Promise<void>> = {
        issue_solved: handleIssueSolved,
        need_more_help: handleNeedMoreHelp,
    };

    const handler = handlers[interaction.customId];
    if (handler) {
        try {
            await handler(interaction);
        } catch (error) {
            console.error(`[Discord Bot] Error handling button ${interaction.customId}:`, error);
            await interaction.reply({
                content: 'An error occurred while processing your request.',
                ephemeral: true,
            });
        }
    }
}

async function handleIssueSolved(interaction: ButtonInteraction): Promise<void> {
    const threadId = getThreadId(interaction);
    if (!threadId) {
        await interaction.reply({
            content: 'This button can only be used inside a support thread.',
            ephemeral: true,
        });
        return;
    }

    const ticket = await findTicketByThreadId(threadId);
    if (!ticket) {
        await interaction.reply({
            content: 'No ticket found for this thread.',
            ephemeral: true,
        });
        return;
    }

    // Update ticket status to CLOSED
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED' },
    });

    // Log the resolution as a system message
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: 'Issue marked as solved by user.',
            type: 'SYSTEM',
        },
    });

    await interaction.reply({
        content: 'Glad we could help! \uD83C\uDF89',
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} closed via "Issue Solved" button`);
}

async function handleNeedMoreHelp(interaction: ButtonInteraction): Promise<void> {
    const threadId = getThreadId(interaction);
    if (!threadId) {
        await interaction.reply({
            content: 'This button can only be used inside a support thread.',
            ephemeral: true,
        });
        return;
    }

    const ticket = await findTicketByThreadId(threadId);
    if (!ticket) {
        await interaction.reply({
            content: 'No ticket found for this thread.',
            ephemeral: true,
        });
        return;
    }

    // Update ticket to waiting on team
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'WAITING_ON_TEAM' },
    });

    // Enqueue an escalation notification
    await createJob(JobType.ESCALATION, {
        ticketId: ticket.id,
        reason: `User requested more help via "Need more help" button in thread ${threadId}`,
    });

    // Log the escalation
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: 'User requested more help. Escalating to team.',
            type: 'SYSTEM',
        },
    });

    await interaction.reply({
        content: 'A team member has been notified and will follow up shortly.',
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} escalated via "Need more help" button`);
}

function getThreadId(interaction: ButtonInteraction): string | null {
    const channel = interaction.channel;
    if (!channel) return null;
    if (
        channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread
    ) {
        return channel.id;
    }
    return null;
}
