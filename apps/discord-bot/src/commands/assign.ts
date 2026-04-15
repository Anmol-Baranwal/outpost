import type { ChatInputCommandInteraction } from 'discord.js';

export async function handleAssign(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user', true);
    const ticketId = interaction.options.getString('ticket');

    // TODO: Implement ticket assignment
    // 1. Look up or create ticket for current thread
    // 2. Assign to specified team member
    // 3. Update ticket status to IN_PROGRESS
    // 4. Notify the assignee

    await interaction.reply({
        content: `Assigned ${ticketId ? `ticket ${ticketId}` : 'this thread'} to ${user.tag}.`,
        ephemeral: false,
    });
}
