import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockOnboardingMemberFindMany = vi.fn();
const mockOnboardingMemberFindUnique = vi.fn();
const mockOnboardingMemberUpdate = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        onboardingMember: {
            findMany: (...args: unknown[]) => mockOnboardingMemberFindMany(...args),
            findUnique: (...args: unknown[]) => mockOnboardingMemberFindUnique(...args),
            update: (...args: unknown[]) => mockOnboardingMemberUpdate(...args),
        },
    },
}));

// ─── Mock next-auth ─────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();

vi.mock('next-auth/next', () => ({
    getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('next-auth', () => ({
    getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// ─── Mock shared ────────────────────────────────────────────────────────────

vi.mock('@copilotkit/outpost/shared', async () => {
    const actual = await vi.importActual('@copilotkit/outpost/shared');
    return actual;
});

// Import after mocks
import { GET as getMembers } from '@/app/api/onboarding/members/route';
import { PATCH as patchMember } from '@/app/api/onboarding/members/[id]/route';
import { GET as getMetrics } from '@/app/api/onboarding/metrics/route';

// ─── Helpers ────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server';

function makeGetRequest(url: string): NextRequest {
    return new NextRequest(url, { method: 'GET' });
}

function makeJsonRequest(url: string, body: unknown, method = 'PATCH'): NextRequest {
    return new NextRequest(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const MOCK_MEMBER = {
    id: 'om-1',
    discordId: 'd1',
    username: 'alice',
    joinedAt: new Date(),
    funnelStage: 'JOINED',
    contacted: false,
    responded: false,
    meetingBooked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
};

// ─── Session helpers ────────────────────────────────────────────────────────

// Writes on these routes are admin-gated (see require-admin); role-tier
// behaviour is covered in api-route-auth.test.ts. These route-logic tests
// authenticate as an authorized admin.
function userSession(memberId = 'tm-1') {
    return {
        user: {
            id: memberId,
            name: 'Test User',
            email: 'test@test.com',
            role: 'ADMIN',
            memberId,
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/onboarding/members', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns members', async () => {
        mockOnboardingMemberFindMany.mockResolvedValue([MOCK_MEMBER]);

        const req = makeGetRequest('http://localhost:3000/api/onboarding/members');
        const res = await getMembers(req as never);
        const body = await res.json();

        expect(body.members).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('returns empty when no members', async () => {
        mockOnboardingMemberFindMany.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/onboarding/members');
        const res = await getMembers(req as never);
        const body = await res.json();

        expect(body.members).toHaveLength(0);
    });

    it('filters by date range', async () => {
        mockOnboardingMemberFindMany.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/onboarding/members?from=2024-01-01&to=2024-12-31');
        await getMembers(req as never);

        expect(mockOnboardingMemberFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    joinedAt: expect.objectContaining({
                        gte: expect.any(Date),
                        lte: expect.any(Date),
                    }),
                }),
            }),
        );
    });
});

describe('PATCH /api/onboarding/members/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('updates funnel stage', async () => {
        mockOnboardingMemberFindUnique.mockResolvedValue(MOCK_MEMBER);
        mockOnboardingMemberUpdate.mockResolvedValue({ ...MOCK_MEMBER, funnelStage: 'CONTACTED', contacted: true });

        const req = makeJsonRequest('http://localhost:3000/api/onboarding/members/om-1', { funnelStage: 'CONTACTED' });
        const res = await patchMember(req as never, { params: Promise.resolve({ id: 'om-1' }) });
        const body = await res.json();

        expect(body.funnelStage).toBe('CONTACTED');
        expect(body.contacted).toBe(true);
    });

    it('returns 404 for non-existent member', async () => {
        mockOnboardingMemberFindUnique.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/onboarding/members/nope', { funnelStage: 'CONTACTED' });
        const res = await patchMember(req as never, { params: Promise.resolve({ id: 'nope' }) });

        expect(res.status).toBe(404);
    });

    it('rejects missing funnelStage', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/onboarding/members/om-1', {});
        const res = await patchMember(req as never, { params: Promise.resolve({ id: 'om-1' }) });

        expect(res.status).toBe(400);
    });

    it('rejects invalid funnel stage', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/onboarding/members/om-1', { funnelStage: 'INVALID' });
        const res = await patchMember(req as never, { params: Promise.resolve({ id: 'om-1' }) });

        expect(res.status).toBe(400);
    });
});

describe('GET /api/onboarding/metrics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns funnel metrics', async () => {
        mockOnboardingMemberFindMany.mockResolvedValue([
            { ...MOCK_MEMBER, funnelStage: 'JOINED' },
            { ...MOCK_MEMBER, id: 'om-2', funnelStage: 'CONTACTED', contacted: true },
        ]);

        const req = makeGetRequest('http://localhost:3000/api/onboarding/metrics');
        const res = await getMetrics(req as never);
        const body = await res.json();

        expect(body).toBeDefined();
        // computeFunnelMetrics returns an object with stage counts
        expect(typeof body).toBe('object');
    });

    it('returns metrics for empty data', async () => {
        mockOnboardingMemberFindMany.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/onboarding/metrics');
        const res = await getMetrics(req as never);
        const body = await res.json();

        expect(body).toBeDefined();
    });
});
