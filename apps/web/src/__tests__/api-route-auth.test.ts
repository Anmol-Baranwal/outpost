import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();

vi.mock('next-auth', () => ({
    getServerSession: mockGetServerSession,
}));

const mockAccountCreate = vi.fn();
const mockAccountFindMany = vi.fn();
const mockTicketGroupBy = vi.fn();
const mockExternalIdentityFindMany = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        account: {
            create: (...args: unknown[]) => mockAccountCreate(...args),
            findMany: (...args: unknown[]) => mockAccountFindMany(...args),
        },
        ticket: {
            groupBy: (...args: unknown[]) => mockTicketGroupBy(...args),
        },
        externalIdentity: {
            findMany: (...args: unknown[]) => mockExternalIdentityFindMany(...args),
        },
    },
}));

// Session fixtures
const ADMIN_SESSION = { user: { id: 'u-admin', email: 'admin@copilotkit.ai', role: 'ADMIN' } };
const MEMBER_SESSION = { user: { id: 'u-member', email: 'member@copilotkit.ai', role: 'MEMBER' } };
const NO_ROLE_SESSION = { user: { id: 'u-norole', email: 'norole@copilotkit.ai' } };

function postRequest(body: unknown): NextRequest {
    return { json: async () => body } as unknown as NextRequest;
}

function getRequest(): NextRequest {
    return { nextUrl: { searchParams: new URLSearchParams() } } as unknown as NextRequest;
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── Helper unit tests ────────────────────────────────────────────────────────

describe('require-admin helpers', () => {
    describe('requireSession', () => {
        it('returns 401 when no session', async () => {
            mockGetServerSession.mockResolvedValue(null);
            const { requireSession } = await import('@/lib/require-admin');
            const { error, session } = await requireSession();
            expect(session).toBeNull();
            expect(error?.status).toBe(401);
        });

        it('passes through when a session exists (any role)', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            const { requireSession } = await import('@/lib/require-admin');
            const { error, session } = await requireSession();
            expect(error).toBeNull();
            expect(session).toEqual(MEMBER_SESSION);
        });
    });

    describe('requireAdmin', () => {
        it('returns 401 when no session', async () => {
            mockGetServerSession.mockResolvedValue(null);
            const { requireAdmin } = await import('@/lib/require-admin');
            const { error } = await requireAdmin();
            expect(error?.status).toBe(401);
        });

        it('returns 403 for a member-role session', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            const { requireAdmin } = await import('@/lib/require-admin');
            const { error } = await requireAdmin();
            expect(error?.status).toBe(403);
        });

        it('returns 403 when the session has no role', async () => {
            mockGetServerSession.mockResolvedValue(NO_ROLE_SESSION);
            const { requireAdmin } = await import('@/lib/require-admin');
            const { error } = await requireAdmin();
            expect(error?.status).toBe(403);
        });

        it('passes through for an admin-role session', async () => {
            mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
            const { requireAdmin } = await import('@/lib/require-admin');
            const { error, session } = await requireAdmin();
            expect(error).toBeNull();
            expect(session).toEqual(ADMIN_SESSION);
        });
    });

    describe('requireRole', () => {
        it('returns 403 when role is not in the allow-list', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            const { requireRole } = await import('@/lib/require-admin');
            const { error } = await requireRole('ADMIN');
            expect(error?.status).toBe(403);
        });

        it('passes through when role is in the allow-list', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            const { requireRole } = await import('@/lib/require-admin');
            const { error } = await requireRole('ADMIN', 'MEMBER');
            expect(error).toBeNull();
        });
    });
});

// ─── Route enforcement tests (one route per tier) ─────────────────────────────

describe('API route auth enforcement', () => {
    describe('POST /api/accounts (admin-tier write)', () => {
        it('rejects unauthenticated with 401', async () => {
            mockGetServerSession.mockResolvedValue(null);
            const { POST } = await import('@/app/api/accounts/route');
            const res = await POST(postRequest({ name: 'Acme' }));
            expect(res.status).toBe(401);
            expect(mockAccountCreate).not.toHaveBeenCalled();
        });

        it('rejects a member-role JWT with 403', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            const { POST } = await import('@/app/api/accounts/route');
            const res = await POST(postRequest({ name: 'Acme' }));
            expect(res.status).toBe(403);
            expect(mockAccountCreate).not.toHaveBeenCalled();
        });

        it('allows an admin-role JWT', async () => {
            mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
            mockAccountCreate.mockResolvedValue({ id: 'a1', name: 'Acme' });
            const { POST } = await import('@/app/api/accounts/route');
            const res = await POST(postRequest({ name: 'Acme' }));
            expect(res.status).toBe(201);
            expect(mockAccountCreate).toHaveBeenCalled();
        });
    });

    describe('GET /api/accounts (member-tier read)', () => {
        it('rejects unauthenticated with 401', async () => {
            mockGetServerSession.mockResolvedValue(null);
            const { GET } = await import('@/app/api/accounts/route');
            const res = await GET(getRequest());
            expect(res.status).toBe(401);
        });

        it('allows a member-role JWT to read', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            mockAccountFindMany.mockResolvedValue([]);
            mockTicketGroupBy.mockResolvedValue([]);
            const { GET } = await import('@/app/api/accounts/route');
            const res = await GET(getRequest());
            expect(res.status).toBe(200);
        });
    });

    describe('PUT /api/sync/mappings (admin-tier write on a read/write route)', () => {
        it('lets a member read via GET', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            mockExternalIdentityFindMany.mockResolvedValue([]);
            const { GET } = await import('@/app/api/sync/mappings/route');
            const res = await GET();
            expect(res.status).toBe(200);
        });

        it('rejects a member-role JWT from writing via PUT with 403', async () => {
            mockGetServerSession.mockResolvedValue(MEMBER_SESSION);
            const { PUT } = await import('@/app/api/sync/mappings/route');
            const res = await PUT(postRequest({ statusMappings: {}, priorityMappings: {} }));
            expect(res.status).toBe(403);
        });
    });
});
