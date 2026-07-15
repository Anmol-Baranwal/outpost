/**
 * Platform Adapter Registry — maps TicketSource enum values to adapter instances.
 *
 * Lazily initializes adapters the first time they are requested.
 * Throws clear errors if credentials are missing for a requested platform.
 */

import { TicketSource } from '../types.js';
import type { PlatformAdapter } from './types.js';

// Adapter constructors, imported lazily to avoid pulling in SDKs at module load time.
import { DiscordAdapter } from './discord.js';
import { GitHubAdapter } from './github.js';
import { SlackAdapter } from './slack.js';
import { TeamsAdapter } from './teams.js';
import { EmailPostmarkAdapter } from './email-postmark.js';

// ─── Registry ────────────────────────────────────────────────────────────

/** Cache of initialized adapters keyed by TicketSource */
const adapters = new Map<TicketSource, PlatformAdapter>();

/**
 * Factory functions that construct each adapter from environment variables.
 * Each factory validates that required credentials are present and throws
 * a descriptive error if they are not.
 */
const factories: Partial<Record<TicketSource, () => PlatformAdapter>> = {
    [TicketSource.DISCORD]: () => {
        // Use DISCORD_TOKEN (the name used by the bot app, .env.example, and docs);
        // fall back to DISCORD_BOT_TOKEN for backward compatibility.
        const token = process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
        if (!token) {
            throw new Error(
                'Missing DISCORD_TOKEN environment variable — cannot initialize Discord adapter',
            );
        }
        return new DiscordAdapter({ token });
    },

    [TicketSource.GITHUB_ISSUE]: () => {
        const appId = process.env.GITHUB_APP_ID;
        const privateKey = process.env.GITHUB_PRIVATE_KEY;
        const installationId = process.env.GITHUB_INSTALLATION_ID;
        if (!appId || !privateKey || !installationId) {
            throw new Error(
                'Missing GITHUB_APP_ID, GITHUB_PRIVATE_KEY, or GITHUB_INSTALLATION_ID — cannot initialize GitHub adapter',
            );
        }
        return new GitHubAdapter({
            appId,
            privateKey,
            installationId: Number(installationId),
        });
    },

    [TicketSource.GITHUB_DISCUSSION]: () => {
        // Reuse the same GitHub adapter — discussions use the same Octokit client
        const appId = process.env.GITHUB_APP_ID;
        const privateKey = process.env.GITHUB_PRIVATE_KEY;
        const installationId = process.env.GITHUB_INSTALLATION_ID;
        if (!appId || !privateKey || !installationId) {
            throw new Error(
                'Missing GITHUB_APP_ID, GITHUB_PRIVATE_KEY, or GITHUB_INSTALLATION_ID — cannot initialize GitHub adapter',
            );
        }
        return new GitHubAdapter({
            appId,
            privateKey,
            installationId: Number(installationId),
        });
    },

    [TicketSource.SLACK]: () => {
        const token = process.env.SLACK_BOT_TOKEN;
        if (!token) {
            throw new Error(
                'Missing SLACK_BOT_TOKEN environment variable — cannot initialize Slack adapter',
            );
        }
        return new SlackAdapter({ token });
    },

    [TicketSource.TEAMS]: () => {
        const appId = process.env.TEAMS_APP_ID;
        const appPassword = process.env.TEAMS_APP_PASSWORD;
        if (!appId || !appPassword) {
            throw new Error(
                'Missing TEAMS_APP_ID or TEAMS_APP_PASSWORD — cannot initialize Teams adapter',
            );
        }
        return new TeamsAdapter({ appId, appPassword });
    },

    [TicketSource.EMAIL]: () => {
        const apiKey = process.env.POSTMARK_API_KEY;
        const fromEmail = process.env.POSTMARK_FROM_EMAIL;
        if (!apiKey || !fromEmail) {
            throw new Error(
                'Missing POSTMARK_API_KEY or POSTMARK_FROM_EMAIL — cannot initialize Email adapter',
            );
        }
        return new EmailPostmarkAdapter({ apiKey, fromEmail });
    },
};

/**
 * Supported platform sources that have adapter implementations.
 * WEB, LINEAR, MANUAL, and ORCA do not have adapters because they
 * either don't have an external API to post to, or are handled
 * through different mechanisms.
 */
export const SUPPORTED_PLATFORMS: readonly TicketSource[] = [
    TicketSource.DISCORD,
    TicketSource.GITHUB_ISSUE,
    TicketSource.GITHUB_DISCUSSION,
    TicketSource.SLACK,
    TicketSource.TEAMS,
    TicketSource.EMAIL,
] as const;

/**
 * Get a platform adapter by TicketSource.
 *
 * Lazily constructs the adapter on first access and caches it.
 * Throws if the platform has no adapter implementation or if
 * required credentials are missing from the environment.
 */
export function getAdapter(source: TicketSource): PlatformAdapter {
    const cached = adapters.get(source);
    if (cached) return cached;

    const factory = factories[source];
    if (!factory) {
        throw new Error(
            `No platform adapter registered for source "${source}". ` +
            `Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`,
        );
    }

    const adapter = factory();
    adapters.set(source, adapter);
    return adapter;
}

/**
 * Check if a platform source has an adapter implementation.
 */
export function hasAdapter(source: TicketSource): boolean {
    return source in factories || factories[source] !== undefined;
}

/**
 * Clear all cached adapter instances.
 * Useful for testing to force re-initialization with different credentials.
 */
export function clearAdapterCache(): void {
    adapters.clear();
}
