import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import { handleAssign } from '../commands/assign.js';
import { handleClose } from '../commands/close.js';
import { handleEscalate } from '../commands/escalate.js';
import { handlePriority } from '../commands/priority.js';
import { handleButtonInteraction } from '../interactions/buttons.js';

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
        const commandHandlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
            assign: handleAssign,
            close: handleClose,
            escalate: handleEscalate,
            priority: handlePriority,
        };

        const handler = commandHandlers[interaction.commandName];
        if (handler) {
            try {
                await handler(interaction);
            } catch (error) {
                console.error(`[Discord Bot] Error handling command /${interaction.commandName}:`, error);
                try {
                    const reply = interaction.replied || interaction.deferred
                        ? interaction.followUp.bind(interaction)
                        : interaction.reply.bind(interaction);
                    await reply({ content: 'An error occurred while processing this command.', ephemeral: true });
                } catch (replyError) {
                    // Interaction may have timed out or already been acknowledged — nothing more we can do
                    console.error(`[Discord Bot] Failed to send error reply for /${interaction.commandName}:`, replyError);
                }
            }
        }
    } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
    }
}
