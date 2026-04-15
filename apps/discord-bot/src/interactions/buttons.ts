import type { ButtonInteraction } from 'discord.js';

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
    // TODO: Implement issue resolution via button
    // 1. Find ticket for current thread
    // 2. Update status to RESOLVED
    // 3. Record customer satisfaction

    await interaction.reply({
        content: 'Glad we could help! This ticket has been marked as resolved.',
        ephemeral: false,
    });
}

async function handleNeedMoreHelp(interaction: ButtonInteraction): Promise<void> {
    // TODO: Implement re-opening via button
    // 1. Find ticket for current thread
    // 2. Update status to OPEN
    // 3. Notify the assigned team member

    await interaction.reply({
        content: 'No problem! A team member will follow up shortly.',
        ephemeral: false,
    });
}
