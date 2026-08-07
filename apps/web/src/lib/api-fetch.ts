/**
 * Client-side fetch wrapper for Outpost's own API.
 *
 * Every mutating request to `/api/*` must carry an `X-CSRF-Token` header: the
 * middleware calls `requiresCsrfValidation()` and rejects with 403 when the header
 * is missing (`src/middleware.ts`, `src/lib/csrf.ts`). Attaching it used to be the
 * caller's job via `csrfHeaders()`, and every caller forgot — 19 client files issued
 * mutating fetches and none sent the header, so no authenticated write in the
 * dashboard could persist. This wrapper exists so the correct behaviour is the
 * default rather than something each new `fetch` has to remember.
 *
 * Use it for same-origin calls to Outpost's API. It is deliberately thin: it does
 * not parse the body, throw on non-2xx, or retry — callers keep full control of the
 * Response, so migrating an existing `fetch` is a one-line change.
 */

import { csrfHeaders } from './csrf-client';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `fetch`, with the CSRF token attached on mutating requests.
 *
 * JSON `Content-Type` is set only when a body is present and the caller has not
 * chosen its own — so `FormData` uploads, which need the browser to generate a
 * multipart boundary, are left alone.
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();

    // GET/HEAD are not rejected by the middleware, so leave them untouched rather
    // than attaching a token that is never read.
    if (!MUTATING_METHODS.has(method)) {
        return fetch(input, init);
    }

    const headers = new Headers(init.headers);

    for (const [key, value] of Object.entries(csrfHeaders())) {
        // Do not clobber a caller-supplied token; tests set one explicitly.
        if (!headers.has(key)) headers.set(key, value);
    }

    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    if (init.body !== undefined && !isFormData && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(input, { ...init, headers });
}
