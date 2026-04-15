/**
 * Discord bot configuration from environment variables.
 */
export const config = {
    discordToken: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
    guildId: requireEnv('GUILD_ID'),
    monitoredChannelIds: parseCommaSeparated(process.env.MONITORED_CHANNEL_IDS ?? ''),
} as const;

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function parseCommaSeparated(value: string): string[] {
    return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
