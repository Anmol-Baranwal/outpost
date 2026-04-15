/**
 * GitHub App configuration from environment variables.
 */
export const config = {
    appId: requireEnv('GITHUB_APP_ID'),
    privateKey: requireEnv('GITHUB_PRIVATE_KEY'),
    webhookSecret: requireEnv('GITHUB_WEBHOOK_SECRET'),
    port: parseInt(process.env.PORT ?? '3200', 10),
} as const;

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
