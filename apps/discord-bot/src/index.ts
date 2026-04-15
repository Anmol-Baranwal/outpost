import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config.js';
import { handleReady } from './events/ready.js';
import { handleMessageCreate } from './events/message-create.js';
import { handleInteractionCreate } from './events/interaction-create.js';
import { handleThreadCreate } from './events/thread-create.js';
import { handleGuildMemberAdd } from './events/guild-member-add.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Register event handlers
client.once(Events.ClientReady, handleReady);
client.on(Events.MessageCreate, handleMessageCreate);
client.on(Events.InteractionCreate, handleInteractionCreate);
client.on(Events.ThreadCreate, handleThreadCreate);
client.on(Events.GuildMemberAdd, handleGuildMemberAdd);

// Start the bot
client.login(config.discordToken).catch((error) => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down Discord bot...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down Discord bot...');
    client.destroy();
    process.exit(0);
});
