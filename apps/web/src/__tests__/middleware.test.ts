import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next-auth/jwt
const mockGetToken = vi.fn();
vi.mock('next-auth/jwt', () => ({
    getToken: (...args: unknown[]) => mockGetToken(...args),
}));

// Mock next/server
const mockRedirect = vi.fn();
const mockNext = vi.fn().mockReturnValue({ type: 'next' });

vi.mock('next/server', () => ({
    NextResponse: {
        redirect: (...args: unknown[]) => mockRedirect(...args),
        next: () => mockNext(),
    },
}));

// Mock CSRF helpers so they don't touch real request.cookies
vi.mock('@/lib/csrf', () => ({
    requiresCsrfValidation: () => false,
    validateCsrfToken: () => null,
    setCsrfCookie: (_req: unknown, res: unknown) => res,
}));

// Import after mocks
import { middleware } from '@/middleware';

function createMockRequest(pathname: string): unknown {
    return {
        nextUrl: {
            pathname,
        },
        url: `http://localhost:3000${pathname}`,
    };
}

describe('Auth middleware', () => {
    beforeEach(() => {
        mockGetToken.mockReset();
        mockRedirect.mockReset();
        mockRedirect.mockReturnValue({ type: 'redirect' });
        mockNext.mockClear();
    });

    it('allows /login without authentication', async () => {
        const req = createMockRequest('/login');
        await middleware(req as never);
        expect(mockNext).toHaveBeenCalled();
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('allows /api/auth routes without authentication', async () => {
        const req = createMockRequest('/api/auth/callback/github');
        await middleware(req as never);
        expect(mockNext).toHaveBeenCalled();
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('redirects unauthenticated users to /login', async () => {
        mockGetToken.mockResolvedValue(null);
        const req = createMockRequest('/dashboard');
        await middleware(req as never);
        expect(mockRedirect).toHaveBeenCalled();
    });

    it('allows authenticated users through', async () => {
        mockGetToken.mockResolvedValue({ sub: '123', name: 'Test' });
        const req = createMockRequest('/dashboard');
        await middleware(req as never);
        expect(mockNext).toHaveBeenCalled();
    });

    it('allows /setup without authentication', async () => {
        const req = createMockRequest('/setup');
        await middleware(req as never);
        expect(mockNext).toHaveBeenCalled();
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('allows /api/setup without authentication', async () => {
        const req = createMockRequest('/api/setup');
        await middleware(req as never);
        expect(mockNext).toHaveBeenCalled();
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('allows static assets through', async () => {
        const req = createMockRequest('/_next/static/chunk.js');
        await middleware(req as never);
        expect(mockNext).toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
    });
});
