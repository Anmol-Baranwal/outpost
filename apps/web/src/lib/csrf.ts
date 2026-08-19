import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Double-submit cookie CSRF protection.
 *
 * Pattern:
 *   1. Middleware sets a `csrf` cookie on responses it reaches, minting a token only
 *      when the request does not already carry one. The token is NOT re-randomised
 *      per response, and paths that return before `setCsrfCookie` (static assets, and
 *      any path matching the early returns in `middleware.ts`) get no cookie at all.
 *   2. Mutating requests (POST/PUT/PATCH/DELETE) to protected /api/ routes must
 *      echo the same value back in the `X-CSRF-Token` header.
 *   3. Comparison is a manual constant-time XOR loop (see `safeEqual`). There is no
 *      `timingSafeEqual` on this path — see that function's note.
 *
 * Known limitations, tracked as follow-up work rather than fixed here:
 *   - The cookie is adopted from the request if present and is bound to nothing (no
 *     session, no HMAC, no `__Host-` prefix), so a party who can write the cookie can
 *     choose the token. `sameSite: 'strict'` and next-auth's `Lax` session cookie limit
 *     the practical reach.
 *   - Exemptions are expressed as bare prefix matches in two places (`CSRF_EXEMPT_PREFIXES`
 *     here and `PUBLIC_PATHS` in `middleware.ts`) with no path-segment boundary.
 */

export function generateCsrfToken(): string {
    return crypto.randomUUID();
}

/**
 * Compare two strings in constant time.  Returns false when they differ.
 *
 * Next.js middleware runs on the Edge Runtime, where `node:crypto`'s
 * `timingSafeEqual` is unavailable. Web Crypto has no `timingSafeEqual` either —
 * `crypto.subtle.timingSafeEqual` is a Cloudflare Workers extension, not a standard
 * API, so do not re-add a probe for it expecting it to fire on Node or Edge. This is
 * a manual XOR loop: constant-time over the compared bytes, not FIPS-validated.
 *
 * The early return compares UTF-16 string length while the loop compares UTF-8 bytes.
 * For inputs whose byte length differs despite equal string length, `bBuf[i]` is
 * `undefined`, `x ^ undefined` is `x ^ 0`, and `mismatch` stays non-zero — i.e. it
 * fails closed and returns false. Tokens are `crypto.randomUUID()` (ASCII), so the
 * divergent case is unreachable today.
 */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const encoder = new TextEncoder();
    const aBuf = encoder.encode(a);
    const bBuf = encoder.encode(b);

    // Manual constant-time comparison. See the note above on why there is no
    // timingSafeEqual probe here.
    let mismatch = 0;
    for (let i = 0; i < aBuf.length; i++) {
        mismatch |= aBuf[i]! ^ bBuf[i]!;
    }
    return mismatch === 0;
}

/** Paths under /api/ that are exempt from CSRF validation. */
const CSRF_EXEMPT_PREFIXES = [
    '/api/webhooks',
    '/api/auth',
    '/api/health',
    '/api/setup',
];

// Exported so api-fetch.test.ts can assert its client-side copy has not drifted. The
// copy exists because this module imports `next/server` and cannot reach the client
// bundle; a method present in one set and not the other silently drops CSRF coverage.
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns `true` when the request is a mutating API call that needs CSRF
 * validation (i.e. it is NOT exempt).
 */
export function requiresCsrfValidation(request: NextRequest): boolean {
    const { pathname } = request.nextUrl;
    // Uppercased before lookup: the Fetch spec normalises only DELETE/GET/HEAD/OPTIONS/
    // POST/PUT, so `method: 'patch'` arrives lowercase and a case-sensitive check would
    // return false here — skipping CSRF validation entirely on the six PATCH routes.
    if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;
    if (!pathname.startsWith('/api/')) return false;
    if (CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) return false;
    return true;
}

/**
 * Validate the CSRF token.  Returns a 403 response if validation fails, or
 * `null` if the request is valid and should be allowed through.
 */
export function validateCsrfToken(request: NextRequest): NextResponse | null {
    const cookieToken = request.cookies.get('csrf')?.value;
    const headerToken = request.headers.get('X-CSRF-Token');

    if (!cookieToken || !headerToken) {
        return NextResponse.json(
            { error: 'Missing CSRF token' },
            { status: 403 },
        );
    }

    if (!safeEqual(cookieToken, headerToken)) {
        return NextResponse.json(
            { error: 'Invalid CSRF token' },
            { status: 403 },
        );
    }

    return null; // valid
}

/**
 * Attach the `csrf` cookie to an outgoing response.
 *
 * If the request already carries one we adopt that value verbatim; otherwise we mint a
 * new one. The token is therefore never rotated — not on login, not on privilege change
 * — and the adopted value is not verified against anything. Both are noted as follow-up
 * work in this module's header.
 */
export function setCsrfCookie(request: NextRequest, response: NextResponse): NextResponse {
    const existing = request.cookies.get('csrf')?.value;
    const token = existing || generateCsrfToken();

    response.cookies.set('csrf', token, {
        httpOnly: false,     // JS must be able to read it for the header
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
    });

    return response;
}
