import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validateConfig', () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;

    afterEach(() => {
        // Restore original env
        if (originalEnv !== undefined) {
            process.env.ANTHROPIC_API_KEY = originalEnv;
        } else {
            delete process.env.ANTHROPIC_API_KEY;
        }
        vi.resetModules();
    });

    it('throws when ANTHROPIC_API_KEY is empty', async () => {
        process.env.ANTHROPIC_API_KEY = '';
        // Re-import to pick up the new env
        const { validateConfig } = await import('./config.js');
        expect(() => validateConfig()).toThrow('ANTHROPIC_API_KEY is required');
    });

    it('throws when ANTHROPIC_API_KEY is missing', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        const { validateConfig } = await import('./config.js');
        expect(() => validateConfig()).toThrow('ANTHROPIC_API_KEY is required');
    });

    it('does not throw when ANTHROPIC_API_KEY is set', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-test-key';
        const { validateConfig } = await import('./config.js');
        expect(() => validateConfig()).not.toThrow();
    });
});
