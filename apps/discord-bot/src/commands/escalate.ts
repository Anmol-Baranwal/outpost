import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { findTicketByThreadId } from '../lib/tickets.js';

export async function handleEscalate(interaction: ChatInputCommandInteraction): Promise<void> {
    const reason = interaction.options.getString('reason') ?? 'Needs engineering attention';

    const channel = interaction.channel;
    if (
        !channel ||
        (channel.type !== ChannelType.PublicThread &&
            channel.type !== ChannelType.PrivateThread)
    ) {
        await interaction.reply({
            content: 'This command must be used in a support thread.',
            ephemeral: true,
        });
        return;
    }

    const ticket = await findTicketByThreadId(channel.id);
    if (!ticket) {
        await interaction.reply({
            content: 'No ticket found for this thread.',
            ephemeral: true,
        });
        return;
    }

    // Escalate: bump priority to HIGH if currently below it
    const escalatedPriority =
        ticket.priority === 'CRITICAL' ? 'CRITICAL' : 'HIGH';

    await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
            priority: escalatedPriority,
            status: 'WAITING_ON_TEAM',
        },
    });

    // Add escalation note
    await prisma.note.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: `Escalated. Reason: ${reason}`,
        },
    });

    // Enqueue escalation notification
    await createJob(JobType.ESCALATION, {
        ticketId: ticket.id,
        reason: `Escalated by ${interaction.user.tag}: ${reason}`,
    });

    await interaction.reply({
        content: `Ticket ${ticket.displayId} escalated to ${escalatedPriority} priority. Reason: ${reason}`,
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} escalated by ${interaction.user.tag}`);
}
