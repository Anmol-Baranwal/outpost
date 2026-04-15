import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '@outpost/db';
import { findTicketByThreadId } from '../lib/tickets.js';

export async function handleAssign(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user', true);
    const ticketIdOption = interaction.options.getString('ticket');

    let ticket;

    if (ticketIdOption) {
        // Look up by explicit ticket ID
        ticket = await prisma.ticket.findUnique({
            where: { displayId: ticketIdOption },
        });
    } else {
        // Look up by current thread
        const channel = interaction.channel;
        if (
            !channel ||
            (channel.type !== ChannelType.PublicThread &&
                channel.type !== ChannelType.PrivateThread)
        ) {
            await interaction.reply({
                content: 'This command must be used in a support thread, or provide a ticket ID.',
                ephemeral: true,
            });
            return;
        }
        ticket = await findTicketByThreadId(channel.id);
    }

    if (!ticket) {
        await interaction.reply({
            content: 'No ticket found. Make sure you are in a tracked thread or provide a valid ticket ID.',
            ephemeral: true,
        });
        return;
    }

    // Find or note the team member by Discord ID
    // Look up team member by matching the Discord user to a User record, then to TeamMember by email
    const dbUser = await prisma.user.findFirst({
        where: { externalId: user.id, source: 'DISCORD' },
    });

    let assigneeId: string | null = null;
    if (dbUser?.email) {
        const teamMember = await prisma.teamMember.findUnique({
            where: { email: dbUser.email },
        });
        assigneeId = teamMember?.id ?? null;
    }

    // Update the ticket
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
            assigneeId,
            status: 'IN_PROGRESS',
        },
    });

    // Log the assignment
    await prisma.note.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: `Assigned to ${user.tag} (${user.id})`,
        },
    });

    await interaction.reply({
        content: `Ticket ${ticket.displayId} assigned to ${user.tag} and marked as In Progress.`,
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} assigned to ${user.tag}`);
}
