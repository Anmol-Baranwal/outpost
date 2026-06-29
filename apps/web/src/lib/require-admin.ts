import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { authOptions } from '@/lib/auth';

export type Role = 'ADMIN' | 'MEMBER';

type AuthResult =
    | { error: NextResponse; session: null }
    | { error: null; session: Session };

function getSessionRole(session: Session): Role {
    return ((session.user as Record<string, unknown>)?.role as Role) ?? 'MEMBER';
}

/**
 * Require an authenticated session. Returns a 401 response in `error` when no
 * session is present. Middleware already rejects requests without a JWT, but
 * routes still call this so they can read the resolved user and stay
 * self-protecting if ever reached outside the middleware matcher.
 */
export async function requireSession(): Promise<AuthResult> {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return {
            error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
            session: null,
        };
    }

    return { error: null, session };
}

/**
 * Require an authenticated session whose role is one of `roles`. Returns 401
 * when unauthenticated and 403 when the role is not permitted.
 */
export async function requireRole(...roles: Role[]): Promise<AuthResult> {
    const result = await requireSession();
    if (result.error) return result;

    if (!roles.includes(getSessionRole(result.session))) {
        return {
            error: NextResponse.json(
                { error: 'Forbidden: insufficient permissions' },
                { status: 403 },
            ),
            session: null,
        };
    }

    return result;
}

/**
 * Require an authenticated ADMIN session. Returns 401 when unauthenticated and
 * 403 when the user is not an admin.
 */
export async function requireAdmin(): Promise<AuthResult> {
    const result = await requireSession();
    if (result.error) return result;

    if (getSessionRole(result.session) !== 'ADMIN') {
        return {
            error: NextResponse.json(
                { error: 'Forbidden: admin access required' },
                { status: 403 },
            ),
            session: null,
        };
    }

    return result;
}
