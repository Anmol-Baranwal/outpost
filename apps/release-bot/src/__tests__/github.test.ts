import { afterEach, describe, expect, it, vi } from 'vitest';
import { team } from '../github.js';

const ORIGINAL_FETCH = globalThis.fetch;

function respondWith(handler: (url: string) => { status?: number; body: unknown }) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (input: string | URL) => {
        const url = String(input);
        calls.push(url);
        const { status = 200, body } = handler(url);
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status,
                headers: { 'content-type': 'application/json' },
            }),
        );
    });
    return calls;
}

afterEach(() => {
    vi.stubGlobal('fetch', ORIGINAL_FETCH);
    vi.resetModules();
});

/** `team()` memoizes for the process, so each case needs a fresh module. */
async function freshTeam() {
    vi.resetModules();
    return (await import('../github.js')).team;
}

describe('team', () => {
    it('reads every org, not just the first', async () => {
        // Returning instead of breaking meant ag-ui-protocol was never queried,
        // and its members were then thanked publicly as outside contributors.
        process.env.GITHUB_TOKEN = 'test';
        const calls = respondWith((url) =>
            url.includes('/orgs/CopilotKit/')
                ? { body: [{ login: 'NathanTarbert' }] }
                : { body: [{ login: 'mme' }] },
        );

        const result = await (await freshTeam())();

        expect(calls.filter((c) => c.includes('/orgs/CopilotKit/members')).length).toBe(1);
        expect(calls.filter((c) => c.includes('/orgs/ag-ui-protocol/members')).length).toBe(1);
        expect(result.resolved).toBe(true);
        expect([...result.members].sort()).toEqual(['mme', 'nathantarbert']);
    });

    it('is unresolved when no org can be read', async () => {
        // A token without read:org does not fail, it returns 200 and []. Reading
        // that as "this org has nobody" credits the whole team as outsiders.
        process.env.GITHUB_TOKEN = 'test';
        process.env.CORE_LOGINS = 'someone';
        respondWith(() => ({ body: [] }));

        const result = await (await freshTeam())();

        expect(result.resolved).toBe(false);
        delete process.env.CORE_LOGINS;
    });

    it('still resolves when one org is readable and the other is not', async () => {
        // ag-ui-protocol returns an empty list for a CopilotKit-scoped token,
        // and requiring both made credit impossible in practice.
        process.env.GITHUB_TOKEN = 'test';
        respondWith((url) =>
            url.includes('/orgs/CopilotKit/')
                ? { body: [{ login: 'NathanTarbert' }] }
                : { status: 403, body: { message: 'Forbidden' } },
        );

        const result = await (await freshTeam())();

        expect(result.resolved).toBe(true);
        expect(result.members.has('nathantarbert')).toBe(true);
    });

    it('refuses to run without a token rather than degrading silently', async () => {
        delete process.env.GITHUB_TOKEN;
        respondWith(() => ({ body: [] }));

        await expect((await freshTeam())()).rejects.toThrow(/GITHUB_TOKEN/);
    });
});

describe('module surface', () => {
    it('exports team for callers that need the resolved flag', () => {
        expect(typeof team).toBe('function');
    });
});
