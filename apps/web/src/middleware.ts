import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requiresCsrfValidation, validateCsrfToken, setCsrfCookie } from '@/lib/csrf';

const PUBLIC_PATHS = ['/login', '/api/auth', '/setup', '/api/setup', '/api/health', '/invite/accept', '/api/team/invite/accept', '/api/webhooks'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        return setCsrfCookie(request, NextResponse.next());
    }

    // Allow static assets and Next.js internals
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('callbackUrl', pathname);
        return NextResponse.redirect(loginUrl);
    }

    // CSRF: reject mutating requests to protected API routes without a valid token
    if (requiresCsrfValidation(request)) {
        const rejection = validateCsrfToken(request);
        if (rejection) return setCsrfCookie(request, rejection);
    }

    return setCsrfCookie(request, NextResponse.next());
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
