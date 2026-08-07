/**
 * `apiFetch` is what lets mutating requests clear the middleware.
 *
 * A mutating `/api/*` request is rejected unless it carries both the `csrf` cookie and a
 * matching `X-CSRF-Token` header (src/middleware.ts -> requiresCsrfValidation ->
 * validateCsrfToken). That header was previously each caller's job via `csrfHeaders()`,
 * which nothing used, so dashboard writes 403'd. Routes that kept working did so for two
 * different reasons worth keeping straight: `/api/setup`, `/api/auth`, `/api/webhooks`
 * and `/api/health` are in `CSRF_EXEMPT_PREFIXES`, while `/api/team/invite/accept`
 * survives via `PUBLIC_PATHS` in the middleware, which returns before CSRF runs at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, MUTATING_METHODS } from '@/lib/api-fetch';

const TOKEN = 'test-csrf-token';

function headersOf(call: unknown): Headers {
    return new Headers((call as [string, RequestInit])[1].headers);
}

function initOf(call: unknown): RequestInit {
    return (call as [string, RequestInit])[1];
}

describe('apiFetch', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    // jsdom serves `document.cookie` from a prototype accessor. Defining an own property
    // on the instance SHADOWS it (it does not destroy it), so the repair is deleting the
    // own property in afterEach — after which the accessor is reachable again.
    function setCookie(value: string) {
        Object.defineProperty(document, 'cookie', {
            value,
            configurable: true,
            writable: true,
        });
    }

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        setCookie(`csrf=${TOKEN}`);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete (document as unknown as Record<string, unknown>).cookie;
    });

    it.each([...MUTATING_METHODS])('attaches the CSRF token on %s', async (method) => {
        await apiFetch('/api/sync/mappings', { method, body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
    });

    it('stays in sync with the middleware’s own method set', async () => {
        // The set is duplicated because csrf.ts pulls in `next/server` and cannot be
        // imported client-side. Drift would silently drop CSRF coverage for a method.
        const { MUTATING_METHODS: serverSet } = await import('@/lib/csrf');

        expect([...MUTATING_METHODS].sort()).toEqual([...serverSet].sort());
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])(
        'does not attach the token on %s, which the middleware never checks',
        async (method) => {
            await apiFetch('/api/sync/mappings', { method });

            expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBeNull();
        },
    );

    it('normalises a lowercase method before deciding it is mutating', async () => {
        await apiFetch('/api/x', { method: 'post', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
    });

    it('does not send the token to a cross-origin URL', async () => {
        await apiFetch('https://evil.example.com/collect', { method: 'POST', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBeNull();
    });

    it('does send the token to an absolute same-origin URL', async () => {
        await apiFetch(`${location.origin}/api/tickets`, { method: 'POST', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
    });

    it('does not clobber a caller-supplied token', async () => {
        await apiFetch('/api/tickets', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'caller-token' },
            body: '{}',
        });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe('caller-token');
    });

    it('never sets Content-Type — the caller owns it', async () => {
        // An earlier version defaulted it to JSON, which mislabelled URLSearchParams,
        // Blob and plain-text bodies. The wrapper now has exactly one job.
        await apiFetch('/api/tickets', { method: 'POST', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBeNull();
    });

    it('preserves a caller-supplied Content-Type', async () => {
        await apiFetch('/api/x', {
            method: 'POST',
            headers: { 'Content-Type': 'text/csv' },
            body: 'a,b',
        });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBe('text/csv');
    });

    it('passes the rest of init through untouched', async () => {
        const signal = new AbortController().signal;

        await apiFetch('/api/x', {
            method: 'POST',
            body: '{"a":1}',
            signal,
            credentials: 'include',
            cache: 'no-store',
        });

        const init = initOf(fetchMock.mock.calls[0]);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/x');
        expect(init.body).toBe('{"a":1}');
        expect(init.signal).toBe(signal);
        expect(init.credentials).toBe('include');
        expect(init.cache).toBe('no-store');
    });

    it('accepts a Headers instance and lowercase header names', async () => {
        await apiFetch('/api/x', {
            method: 'POST',
            headers: new Headers({ 'x-csrf-token': 'caller-token' }),
            body: '{}',
        });

        // Header names are case-insensitive, so the caller's value must still win.
        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe('caller-token');
    });

    it('sends no token when the cookie is absent, rather than an empty one', async () => {
        setCookie('');

        await apiFetch('/api/tickets', { method: 'POST', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).has('X-CSRF-Token')).toBe(false);
    });
});
