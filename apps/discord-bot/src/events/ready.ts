import type { Client } from 'discord.js';

export function handleReady(client: Client<true>): void {
    console.log(`[Discord Bot] Logged in as ${client.user.tag}`);
    console.log(`[Discord Bot] Serving ${client.guilds.cache.size} guild(s)`);
}
