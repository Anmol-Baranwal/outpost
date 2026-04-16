import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '@copilotkit/outpost/db';
import { findTicketByThreadId } from '../lib/tickets.js';

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
type PriorityLevel = (typeof VALID_PRIORITIES)[number];

const PRIORITY_MAP: Record<PriorityLevel, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> = {
    critical: 'CRITICAL',
    high: 'HIGH',
    medium: 'MEDIUM',
    low: 'LOW',
};

export async function handlePriority(interaction: ChatInputCommandInteraction): Promise<void> {
    const level = interaction.options.getString('level', true) as PriorityLevel;

    if (!VALID_PRIORITIES.includes(level)) {
        await interaction.reply({
            content: `Invalid priority level. Choose one of: ${VALID_PRIORITIES.join(', ')}`,
            ephemeral: true,
        });
        return;
    }

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

    const dbPriority = PRIORITY_MAP[level];

    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { priority: dbPriority },
    });

    // Log the priority change
    await prisma.note.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: `Priority changed from ${ticket.priority} to ${dbPriority}`,
        },
    });

    await interaction.reply({
        content: `Ticket ${ticket.displayId} priority updated to ${dbPriority}.`,
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} priority changed to ${dbPriority}`);
}
