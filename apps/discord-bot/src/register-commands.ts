import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';

const commands = [
    new SlashCommandBuilder()
        .setName('assign')
        .setDescription('Assign a ticket to a team member')
        .addUserOption((option) =>
            option.setName('user').setDescription('Team member to assign').setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('ticket').setDescription('Ticket ID (optional, defaults to current thread)'),
        ),
    new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current support ticket')
        .addStringOption((option) =>
            option.setName('reason').setDescription('Reason for closing'),
        ),
    new SlashCommandBuilder()
        .setName('escalate')
        .setDescription('Escalate the current ticket to engineering')
        .addStringOption((option) =>
            option.setName('reason').setDescription('Reason for escalation'),
        ),
    new SlashCommandBuilder()
        .setName('priority')
        .setDescription('Set ticket priority')
        .addStringOption((option) =>
            option
                .setName('level')
                .setDescription('Priority level')
                .setRequired(true)
                .addChoices(
                    { name: 'Critical', value: 'critical' },
                    { name: 'High', value: 'high' },
                    { name: 'Medium', value: 'medium' },
                    { name: 'Low', value: 'low' },
                ),
        ),
].map((command) => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);

    try {
        console.log(`Registering ${commands.length} slash commands...`);

        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
            body: commands,
        });

        console.log('Commands registered successfully!');
    } catch (error) {
        console.error('Failed to register commands:', error);
        process.exit(1);
    }
}

registerCommands();
