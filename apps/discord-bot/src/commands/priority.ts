import type { ChatInputCommandInteraction } from 'discord.js';

export async function handlePriority(interaction: ChatInputCommandInteraction): Promise<void> {
    const priority = interaction.options.getString('level', true);

    // TODO: Implement priority update
    // 1. Find ticket for current thread
    // 2. Update priority
    // 3. Recalculate SLA based on new priority
    // 4. Notify if SLA is at risk

    await interaction.reply({
        content: `Priority updated to ${priority.toUpperCase()}.`,
        ephemeral: false,
    });
}
