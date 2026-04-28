import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Double-submit cookie CSRF protection.
 *
 * Pattern:
 *   1. Middleware sets a `csrf` cookie with a random token on every response.
 *   2. Mutating requests (POST/PUT/PATCH/DELETE) to protected /api/ routes must
 *      echo the same value back in the `X-CSRF-Token` header.
 *   3. Comparison uses `crypto.timingSafeEqual` to prevent timing side-channels.
 */

export function generateCsrfToken(): string {
    return crypto.randomUUID();
}

/**
 * Compare two strings in constant time.  Returns false if either is missing or
 * if they differ in length.
 *
 * Next.js middleware runs on the Edge Runtime where `node:crypto` is not
 * available, so we use the Web Crypto `subtle.timingSafeEqual` when present
 * and fall back to a manual XOR loop (still constant-time, just not FIPS).
 */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const encoder = new TextEncoder();
    const aBuf = encoder.encode(a);
    const bBuf = encoder.encode(b);

    // Web Crypto timingSafeEqual (available in Node 20+, newer Edge runtimes)
    if (typeof crypto !== 'undefined' && crypto.subtle && 'timingSafeEqual' in crypto.subtle) {
        return (crypto.subtle as { timingSafeEqual(a: BufferSource, b: BufferSource): boolean })
            .timingSafeEqual(aBuf, bBuf);
    }

    // Fallback: manual constant-time comparison
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

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns `true` when the request is a mutating API call that needs CSRF
 * validation (i.e. it is NOT exempt).
 */
export function requiresCsrfValidation(request: NextRequest): boolean {
    const { pathname } = request.nextUrl;
    if (!MUTATING_METHODS.has(request.method)) return false;
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
 * Attach (or refresh) the `csrf` cookie on an outgoing response.
 * If the request already carries one we reuse it; otherwise we mint a new one.
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
