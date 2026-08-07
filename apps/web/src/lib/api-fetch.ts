/**
 * Client-side fetch wrapper for Outpost's own API.
 *
 * Mutating requests to `/api/*` must carry an `X-CSRF-Token` header: the middleware
 * calls `requiresCsrfValidation()` and rejects with 403 when it is missing
 * (`src/middleware.ts`, `src/lib/csrf.ts`). Attaching it used to be the caller's job
 * via `csrfHeaders()` and every caller forgot, so dashboard writes 403'd. Routes under
 * `CSRF_EXEMPT_PREFIXES` (`/api/setup`, `/api/auth`, `/api/webhooks`, `/api/health`)
 * were unaffected — which is why setup, login and invite-accept kept working. This
 * wrapper makes the correct behaviour the default rather than something each new
 * `fetch` has to remember.
 *
 * Use it for same-origin calls to Outpost's API — an absolute cross-origin URL would
 * send the token to that origin. It is deliberately thin: it does not parse the body,
 * throw on non-2xx, or retry, so callers keep full control of the Response.
 */

import { csrfHeaders } from './csrf-client';

// Mirrors MUTATING_METHODS in ./csrf.ts. Duplicated rather than imported because
// csrf.ts pulls in `next/server`, which must not reach the client bundle. Keep the two
// in sync — a method listed in one and not the other silently drops CSRF coverage.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `fetch`, with the CSRF token attached on mutating requests.
 *
 * JSON `Content-Type` is set only when a body is present and the caller has not
 * chosen its own — so `FormData` uploads, which need the browser to generate a
 * multipart boundary, are left alone.
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();

    // GET/HEAD are not rejected by the middleware, so leave them untouched rather
    // than attaching a token that is never read.
    if (!MUTATING_METHODS.has(method)) {
        return fetch(input, init);
    }

    const headers = new Headers(init.headers);

    for (const [key, value] of Object.entries(csrfHeaders())) {
        if (!headers.has(key)) headers.set(key, value);
    }

    // Only a string body gets a default Content-Type. Every other BodyInit carries its
    // own encoding that fetch derives correctly on its own — FormData needs a generated
    // multipart boundary, URLSearchParams is form-urlencoded, a Blob has its own `type`,
    // and ArrayBuffer/TypedArray have none. Stamping `application/json` over any of those
    // would misdescribe the payload and break server-side parsing.
    const shouldDefaultJson =
        typeof init.body === 'string' && init.body !== '' && !headers.has('Content-Type');
    if (shouldDefaultJson) {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(input, { ...init, headers });
}
