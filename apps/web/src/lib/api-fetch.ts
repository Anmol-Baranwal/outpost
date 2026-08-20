/**
 * Client-side fetch wrapper that attaches the CSRF token.
 *
 * The middleware rejects a mutating `/api/*` request unless it carries both the `csrf`
 * cookie and a matching `X-CSRF-Token` header, except on paths listed in `PUBLIC_PATHS`
 * (`src/middleware.ts`), which return before CSRF runs. Callers used to attach the header
 * themselves via `csrfHeaders()`; this wrapper makes it the default.
 *
 * It does one thing — add that header. It does not set Content-Type, parse bodies, throw
 * on non-2xx, or retry.
 */

import { csrfHeaders } from './csrf-client';

// Mirrors MUTATING_METHODS in ./csrf.ts, which cannot be imported here because it pulls
// in `next/server`. api-fetch.test.ts asserts the two sets stay equal.
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when `url` is known to target this origin. Returns false when that cannot be
 * determined — no `location` (non-browser) or an unparseable URL — so an unverified
 * origin never receives the token.
 */
function isSameOrigin(url: string): boolean {
    if (typeof location === 'undefined') return false;
    try {
        return new URL(url, location.origin).origin === location.origin;
    } catch {
        return false;
    }
}

/**
 * `fetch`, with the CSRF token attached on same-origin mutating requests.
 *
 * `input` is a string, not `RequestInfo | URL`: a `Request` carries its own method, which
 * this function reads from `init`, so accepting one would skip the header.
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();

    if (!MUTATING_METHODS.has(method) || !isSameOrigin(input)) {
        return fetch(input, init);
    }

    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(csrfHeaders())) {
        // Do not clobber a token the caller set deliberately.
        if (!headers.has(key)) headers.set(key, value);
    }

    return fetch(input, { ...init, headers });
}
