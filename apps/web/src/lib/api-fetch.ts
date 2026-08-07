/**
 * Client-side fetch wrapper that attaches the CSRF token.
 *
 * The middleware rejects a mutating `/api/*` request unless it carries both the `csrf`
 * cookie and a matching `X-CSRF-Token` header (`src/middleware.ts`, `src/lib/csrf.ts`).
 * Attaching the header used to be each caller's job via `csrfHeaders()`, and no caller
 * did it, so dashboard writes 403'd. This wrapper makes it the default.
 *
 * Scope is deliberately one job: add the header. It does not set Content-Type, parse
 * bodies, throw on non-2xx, or retry. An earlier version also defaulted Content-Type
 * and accepted `RequestInfo`; both added failure modes worse than the convenience —
 * `Request` carries its own method, which this wrapper does not read, so a POST
 * `Request` silently shipped without a token.
 */

import { csrfHeaders } from './csrf-client';

// Mirrors MUTATING_METHODS in ./csrf.ts, which cannot be imported here because it pulls
// in `next/server`. api-fetch.test.ts asserts the two sets stay equal.
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when `url` targets this origin. A relative path always does; an absolute URL is
 * compared against `location.origin` so the CSRF token is never sent to a third party.
 */
function isSameOrigin(url: string): boolean {
    if (typeof location === 'undefined') return true;
    try {
        return new URL(url, location.origin).origin === location.origin;
    } catch {
        return false;
    }
}

/**
 * `fetch`, with the CSRF token attached on same-origin mutating requests.
 *
 * `input` is a string rather than `RequestInfo | URL` on purpose: a `Request` carries its
 * own method and headers, which this wrapper would have to merge rather than read from
 * `init`. Every call site passes a string today.
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
