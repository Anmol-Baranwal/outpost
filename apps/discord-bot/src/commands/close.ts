import type { ChatInputCommandInteraction } from 'discord.js';

export async function handleClose(interaction: ChatInputCommandInteraction): Promise<void> {
    const reason = interaction.options.getString('reason') ?? 'Resolved';

    // TODO: Implement ticket closing
    // 1. Find ticket for current thread
    // 2. Update status to RESOLVED
    // 3. Add closing note
    // 4. Archive the Discord thread

    await interaction.reply({
        content: `Ticket closed. Reason: ${reason}`,
        ephemeral: false,
    });
}
