import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
    requiresCsrfValidation,
    validateCsrfToken,
    setCsrfCookie,
    generateCsrfToken,
} from '@/lib/csrf';

// ─── Mock request builder ─────────────────────────────────────────────────────

function mockRequest(opts: {
    method?: string;
    pathname?: string;
    cookie?: string;
    header?: string;
} = {}): NextRequest {
    const { method = 'POST', pathname = '/api/tickets', cookie, header } = opts;
    return {
        method,
        nextUrl: { pathname },
        cookies: {
            get: (name: string) =>
                name === 'csrf' && cookie !== undefined ? { value: cookie } : undefined,
        },
        headers: {
            get: (name: string) =>
                name === 'X-CSRF-Token' ? (header ?? null) : null,
        },
    } as unknown as NextRequest;
}

// ─── requiresCsrfValidation ───────────────────────────────────────────────────

describe('requiresCsrfValidation', () => {
    it('returns false for safe methods (GET)', () => {
        expect(requiresCsrfValidation(mockRequest({ method: 'GET' }))).toBe(false);
    });

    it('returns true for mutating API requests', () => {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            expect(requiresCsrfValidation(mockRequest({ method }))).toBe(true);
        }
    });

    it('returns false for non-/api/ paths', () => {
        expect(requiresCsrfValidation(mockRequest({ pathname: '/dashboard' }))).toBe(false);
    });

    it('exempts webhook endpoints (signature auth)', () => {
        expect(
            requiresCsrfValidation(mockRequest({ pathname: '/api/webhooks/postmark/inbound' })),
        ).toBe(false);
    });

    it('exempts /api/auth, /api/health, /api/setup', () => {
        expect(requiresCsrfValidation(mockRequest({ pathname: '/api/auth/signin' }))).toBe(false);
        expect(requiresCsrfValidation(mockRequest({ pathname: '/api/health' }))).toBe(false);
        expect(requiresCsrfValidation(mockRequest({ pathname: '/api/setup' }))).toBe(false);
    });
});

// ─── validateCsrfToken ────────────────────────────────────────────────────────

describe('validateCsrfToken', () => {
    it('rejects with 403 when the cookie is missing', async () => {
        const res = validateCsrfToken(mockRequest({ header: 'abc' }));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        expect((await res!.json()).error).toBe('Missing CSRF token');
    });

    it('rejects with 403 when the header is missing', async () => {
        const res = validateCsrfToken(mockRequest({ cookie: 'abc' }));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        expect((await res!.json()).error).toBe('Missing CSRF token');
    });

    it('rejects with 403 when cookie and header do not match', async () => {
        const res = validateCsrfToken(mockRequest({ cookie: 'abc', header: 'xyz' }));
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        expect((await res!.json()).error).toBe('Invalid CSRF token');
    });

    it('allows the request (returns null) when cookie matches header', () => {
        const token = 'matching-token-value';
        const res = validateCsrfToken(mockRequest({ cookie: token, header: token }));
        expect(res).toBeNull();
    });
});

// ─── setCsrfCookie ────────────────────────────────────────────────────────────

describe('setCsrfCookie', () => {
    it('mints a new token when the request has no csrf cookie', () => {
        const res = setCsrfCookie(mockRequest({}), NextResponse.next());
        const set = res.cookies.get('csrf')?.value;
        expect(set).toBeTruthy();
    });

    it('reuses the existing csrf cookie value', () => {
        const existing = 'existing-token';
        const res = setCsrfCookie(mockRequest({ cookie: existing }), NextResponse.next());
        expect(res.cookies.get('csrf')?.value).toBe(existing);
    });
});

// ─── generateCsrfToken ────────────────────────────────────────────────────────

describe('generateCsrfToken', () => {
    it('returns a non-empty string', () => {
        expect(typeof generateCsrfToken()).toBe('string');
        expect(generateCsrfToken().length).toBeGreaterThan(0);
    });

    it('returns distinct tokens on successive calls', () => {
        expect(generateCsrfToken()).not.toBe(generateCsrfToken());
    });
});
