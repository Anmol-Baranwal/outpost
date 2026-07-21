/**
 * GitHub App configuration from environment variables.
 */
export const config = {
    appId: requireEnv('GITHUB_APP_ID'),
    privateKey: requireEnv('GITHUB_PRIVATE_KEY'),
    installationId: requireEnv('GITHUB_INSTALLATION_ID'),
    webhookSecret: requireEnv('GITHUB_WEBHOOK_SECRET'),
    port: parseInt(process.env.PORT ?? '3200', 10),
    /** Comma-separated list of GitHub logins considered team members */
    teamLogins: parseCommaSeparated(process.env.GITHUB_TEAM_LOGINS ?? ''),
    /**
     * Comma-separated "owner/repo" list the app is allowed to respond on.
     * Defaults to CopilotKit/CopilotKit so the bot never answers issues on
     * other repos it happens to be installed on (e.g. CopilotKit/outpost).
     */
    allowedRepos: parseCommaSeparated(
        process.env.GITHUB_ALLOWED_REPOS ?? 'CopilotKit/CopilotKit',
    ),
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
