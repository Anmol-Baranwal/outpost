/**
 * Linear sync configuration from environment variables.
 */
export const config = {
    linearWebhookSecret: requireEnv('LINEAR_WEBHOOK_SECRET'),
    linearApiKey: requireEnv('LINEAR_API_KEY'),
    linearTeamId: requireEnv('LINEAR_TEAM_ID'),
    port: parseInt(process.env.PORT ?? '3004', 10),
    healthPort: parseInt(process.env.HEALTH_PORT ?? '3004', 10),
} as const;

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
