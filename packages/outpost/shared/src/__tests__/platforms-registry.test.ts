import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAdapter, hasAdapter, clearAdapterCache, SUPPORTED_PLATFORMS } from '../platforms/registry.js';
import { TicketSource } from '../types.js';

describe('Platform Registry', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearAdapterCache();
    });

    afterEach(() => {
        // Restore original environment
        process.env = { ...originalEnv };
        clearAdapterCache();
    });

    // ── getAdapter ───────────────────────────────────────────────────

    describe('getAdapter', () => {
        it('returns a Discord adapter when DISCORD_BOT_TOKEN is set', () => {
            process.env.DISCORD_BOT_TOKEN = 'test-token';
            const adapter = getAdapter(TicketSource.DISCORD);

            expect(adapter).toBeDefined();
            expect(adapter.platform).toBe(TicketSource.DISCORD);
        });

        it('returns a GitHub adapter when GitHub credentials are set', () => {
            process.env.GITHUB_APP_ID = '12345';
            process.env.GITHUB_PRIVATE_KEY = 'test-key';
            process.env.GITHUB_INSTALLATION_ID = '67890';

            const adapter = getAdapter(TicketSource.GITHUB_ISSUE);
            expect(adapter).toBeDefined();
            expect(adapter.platform).toBe(TicketSource.GITHUB_ISSUE);
        });

        it('returns a GitHub adapter for GITHUB_DISCUSSION source', () => {
            process.env.GITHUB_APP_ID = '12345';
            process.env.GITHUB_PRIVATE_KEY = 'test-key';
            process.env.GITHUB_INSTALLATION_ID = '67890';

            const adapter = getAdapter(TicketSource.GITHUB_DISCUSSION);
            expect(adapter).toBeDefined();
        });

        it('returns a Slack adapter when SLACK_BOT_TOKEN is set', () => {
            process.env.SLACK_BOT_TOKEN = 'xoxb-test';
            const adapter = getAdapter(TicketSource.SLACK);

            expect(adapter).toBeDefined();
            expect(adapter.platform).toBe(TicketSource.SLACK);
        });

        it('returns a Teams adapter when Teams credentials are set', () => {
            process.env.TEAMS_APP_ID = 'test-app-id';
            process.env.TEAMS_APP_PASSWORD = 'test-password';

            const adapter = getAdapter(TicketSource.TEAMS);
            expect(adapter).toBeDefined();
            expect(adapter.platform).toBe(TicketSource.TEAMS);
        });

        it('returns an Email adapter when Postmark credentials are set', () => {
            process.env.POSTMARK_API_KEY = 'test-key';
            process.env.POSTMARK_FROM_EMAIL = 'support@example.com';

            const adapter = getAdapter(TicketSource.EMAIL);
            expect(adapter).toBeDefined();
            expect(adapter.platform).toBe(TicketSource.EMAIL);
        });

        it('caches adapter instances (returns same object on second call)', () => {
            process.env.DISCORD_BOT_TOKEN = 'test-token';
            const first = getAdapter(TicketSource.DISCORD);
            const second = getAdapter(TicketSource.DISCORD);

            expect(first).toBe(second);
        });

        it('throws descriptive error when credentials are missing for Discord', () => {
            delete process.env.DISCORD_BOT_TOKEN;
            expect(() => getAdapter(TicketSource.DISCORD)).toThrow(
                'Missing DISCORD_BOT_TOKEN',
            );
        });

        it('throws descriptive error when credentials are missing for GitHub', () => {
            delete process.env.GITHUB_APP_ID;
            delete process.env.GITHUB_PRIVATE_KEY;
            delete process.env.GITHUB_INSTALLATION_ID;

            expect(() => getAdapter(TicketSource.GITHUB_ISSUE)).toThrow(
                'Missing GITHUB_APP_ID',
            );
        });

        it('throws descriptive error when partial GitHub credentials provided', () => {
            process.env.GITHUB_APP_ID = '12345';
            // Missing private key and installation ID
            delete process.env.GITHUB_PRIVATE_KEY;
            delete process.env.GITHUB_INSTALLATION_ID;

            expect(() => getAdapter(TicketSource.GITHUB_ISSUE)).toThrow(
                'Missing GITHUB_APP_ID, GITHUB_PRIVATE_KEY, or GITHUB_INSTALLATION_ID',
            );
        });

        it('throws descriptive error when credentials are missing for Slack', () => {
            delete process.env.SLACK_BOT_TOKEN;
            expect(() => getAdapter(TicketSource.SLACK)).toThrow(
                'Missing SLACK_BOT_TOKEN',
            );
        });

        it('throws descriptive error when credentials are missing for Teams', () => {
            delete process.env.TEAMS_APP_ID;
            delete process.env.TEAMS_APP_PASSWORD;
            expect(() => getAdapter(TicketSource.TEAMS)).toThrow(
                'Missing TEAMS_APP_ID or TEAMS_APP_PASSWORD',
            );
        });

        it('throws descriptive error when credentials are missing for Email', () => {
            delete process.env.POSTMARK_API_KEY;
            delete process.env.POSTMARK_FROM_EMAIL;
            expect(() => getAdapter(TicketSource.EMAIL)).toThrow(
                'Missing POSTMARK_API_KEY or POSTMARK_FROM_EMAIL',
            );
        });

        it('throws when requesting an unsupported platform (MANUAL)', () => {
            expect(() => getAdapter(TicketSource.MANUAL)).toThrow(
                'No platform adapter registered for source "MANUAL"',
            );
        });

        it('throws when requesting an unsupported platform (WEB)', () => {
            expect(() => getAdapter(TicketSource.WEB)).toThrow(
                'No platform adapter registered for source "WEB"',
            );
        });

        it('throws when requesting an unsupported platform (LINEAR)', () => {
            expect(() => getAdapter(TicketSource.LINEAR)).toThrow(
                'No platform adapter registered for source "LINEAR"',
            );
        });
    });

    // ── hasAdapter ───────────────────────────────────────────────────

    describe('hasAdapter', () => {
        it('returns true for supported platforms', () => {
            expect(hasAdapter(TicketSource.DISCORD)).toBe(true);
            expect(hasAdapter(TicketSource.GITHUB_ISSUE)).toBe(true);
            expect(hasAdapter(TicketSource.GITHUB_DISCUSSION)).toBe(true);
            expect(hasAdapter(TicketSource.SLACK)).toBe(true);
            expect(hasAdapter(TicketSource.TEAMS)).toBe(true);
            expect(hasAdapter(TicketSource.EMAIL)).toBe(true);
        });

        it('returns false for unsupported platforms', () => {
            expect(hasAdapter(TicketSource.MANUAL)).toBe(false);
            expect(hasAdapter(TicketSource.WEB)).toBe(false);
            expect(hasAdapter(TicketSource.LINEAR)).toBe(false);
            expect(hasAdapter(TicketSource.ORCA)).toBe(false);
        });
    });

    // ── clearAdapterCache ────────────────────────────────────────────

    describe('clearAdapterCache', () => {
        it('forces re-initialization on next getAdapter call', () => {
            process.env.DISCORD_BOT_TOKEN = 'token-1';
            const first = getAdapter(TicketSource.DISCORD);

            clearAdapterCache();

            process.env.DISCORD_BOT_TOKEN = 'token-2';
            const second = getAdapter(TicketSource.DISCORD);

            // Different instances because cache was cleared
            expect(first).not.toBe(second);
        });
    });

    // ── SUPPORTED_PLATFORMS ──────────────────────────────────────────

    describe('SUPPORTED_PLATFORMS', () => {
        it('includes all platforms with adapter implementations', () => {
            expect(SUPPORTED_PLATFORMS).toContain(TicketSource.DISCORD);
            expect(SUPPORTED_PLATFORMS).toContain(TicketSource.GITHUB_ISSUE);
            expect(SUPPORTED_PLATFORMS).toContain(TicketSource.GITHUB_DISCUSSION);
            expect(SUPPORTED_PLATFORMS).toContain(TicketSource.SLACK);
            expect(SUPPORTED_PLATFORMS).toContain(TicketSource.TEAMS);
            expect(SUPPORTED_PLATFORMS).toContain(TicketSource.EMAIL);
        });

        it('does not include unsupported platforms', () => {
            expect(SUPPORTED_PLATFORMS).not.toContain(TicketSource.MANUAL);
            expect(SUPPORTED_PLATFORMS).not.toContain(TicketSource.WEB);
            expect(SUPPORTED_PLATFORMS).not.toContain(TicketSource.LINEAR);
            expect(SUPPORTED_PLATFORMS).not.toContain(TicketSource.ORCA);
        });
    });
});
