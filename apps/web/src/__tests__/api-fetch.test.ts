/**
 * `apiFetch` is the reason mutating requests reach the API at all.
 *
 * The middleware rejects a mutating `/api/*` request unless it carries BOTH the `csrf`
 * cookie and a matching `X-CSRF-Token` header (src/middleware.ts ->
 * requiresCsrfValidation -> validateCsrfToken). That header was previously the caller's
 * responsibility via `csrfHeaders()`, which no client used — so dashboard writes 403'd,
 * except on routes under `CSRF_EXEMPT_PREFIXES` (`/api/setup`, `/api/auth`,
 * `/api/webhooks`, `/api/health`). These tests pin the behaviour that makes attaching
 * the header the default, so the regression cannot return via a newly written fetch.
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
    // jsdom defines `document.cookie` as an accessor. Overwriting it with a data
    // property destroys that accessor for the rest of the file, so capture the
    // original descriptor and put it back in afterEach rather than leaking a broken
    // `document` into every later test.
    const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

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
        // Remove the data property so the prototype accessor is reachable again.
        delete (document as unknown as Record<string, unknown>).cookie;
        if (originalCookie) {
            Object.defineProperty(Document.prototype, 'cookie', originalCookie);
        }
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

    it.each([
        ['URLSearchParams', () => new URLSearchParams({ a: 'b' })],
        ['Blob', () => new Blob(['x'], { type: 'text/csv' })],
        ['ArrayBuffer', () => new ArrayBuffer(4)],
    ])('does not stamp JSON onto a %s body, which carries its own encoding', async (_n, make) => {
        await apiFetch('/api/x', { method: 'POST', body: make() as BodyInit });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBeNull();
        // The token is still required regardless of body type.
        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
    });

    it('does not stamp JSON onto a null body', async () => {
        await apiFetch('/api/x', { method: 'POST', body: null });

        expect(headersOf(fetchMock.mock.calls[0]).get('Content-Type')).toBeNull();
    });

    it('normalises a lowercase method before deciding it is mutating', async () => {
        await apiFetch('/api/x', { method: 'post', body: '{}' });

        expect(headersOf(fetchMock.mock.calls[0]).get('X-CSRF-Token')).toBe(TOKEN);
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
