import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '@copilotkit/outpost/db';
import { findTicketByThreadId } from '../lib/tickets.js';

export async function handleClose(interaction: ChatInputCommandInteraction): Promise<void> {
    const reason = interaction.options.getString('reason') ?? 'Resolved';

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

    // Update ticket status to CLOSED
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED' },
    });

    // Add a closing note
    await prisma.note.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: `Ticket closed. Reason: ${reason}`,
        },
    });

    await interaction.reply({
        content: `Ticket ${ticket.displayId} closed. Reason: ${reason}`,
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} closed by ${interaction.user.tag}`);
}
