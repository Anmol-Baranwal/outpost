import type { Message } from 'discord.js';

export async function handleMessageCreate(message: Message): Promise<void> {
    // Ignore messages from bots
    if (message.author.bot) return;

    // TODO: Implement message processing pipeline
    // 1. Check if message is in a monitored channel
    // 2. If in a support thread, create/update ticket
    // 3. If it's a question, queue AI response generation
    // 4. Track message for sentiment analysis

    console.log(
        `[Discord Bot] Message from ${message.author.tag} in #${message.channel.toString()}: ` +
        `${message.content.slice(0, 100)}`,
    );
}
