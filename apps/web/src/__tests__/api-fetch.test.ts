/**
 * `apiFetch` is the reason mutating requests reach the API at all.
 *
 * The middleware rejects any mutating `/api/*` request without an `X-CSRF-Token`
 * header (src/middleware.ts -> requiresCsrfValidation -> validateCsrfToken). That
 * header was previously the caller's responsibility via `csrfHeaders()`, and all 19
 * client files that issue mutating fetches omitted it — so every authenticated write
 * in the dashboard returned 403. These tests pin the behaviour that makes attaching
 * it the default, so the regression cannot come back by someone writing a new fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from '@/lib/api-fetch';

const TOKEN = 'test-csrf-token';

function headersOf(call: unknown): Headers {
    const init = (call as [string, RequestInit])[1];
    return new Headers(init.headers);
}

describe('apiFetch', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(document, 'cookie', {
            value: `csrf=${TOKEN}`,
            configurable: true,
            writable: true,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
        'attaches the CSRF token on %s',
        async (method) => {
            await apiFetch('/api/sync/mappings', { method, body: '{}' });

            expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
        },
    );

    it('does not attach the token on GET, which the middleware never checks', async () => {
        await apiFetch('/api/sync/mappings');

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBeNull();
    });

    it('does not clobber a caller-supplied token', async () => {
        await apiFetch('/api/tickets', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'caller-token' },
            body: '{}',
        });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe('caller-token');
    });

    it('defaults Content-Type to JSON when a body is sent', async () => {
        await apiFetch('/api/tickets', { method: 'POST', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBe('application/json');
    });

    it('leaves FormData alone so the browser can set the multipart boundary', async () => {
        const body = new FormData();
        body.append('file', 'x');

        await apiFetch('/api/docs/upload', { method: 'POST', body });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBeNull();
        // The token is still required for the request to survive the middleware.
        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
    });

    it('respects an explicit Content-Type', async () => {
        await apiFetch('/api/x', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: 'hi',
        });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBe('text/plain');
    });

    it('sends no token when the cookie is absent, rather than sending an empty one', async () => {
        Object.defineProperty(document, 'cookie', {
            value: '',
            configurable: true,
            writable: true,
        });

        await apiFetch('/api/tickets', { method: 'POST', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).has('X-CSRF-Token')).toBe(false);
    });
});
