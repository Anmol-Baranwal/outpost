import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        organization: {
            findFirst: () => mockFindFirst(),
            update: (args: unknown) => mockUpdate(args),
        },
    },
}));

// ─── Mock next-auth ─────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();

vi.mock('next-auth/next', () => ({
    getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// Import after mocks
import { GET, PUT } from '@/app/api/org/route';

function makeRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost:3000/api/org', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const sampleOrg = {
    id: 'org-1',
    name: 'Acme Corp',
    email: 'support@acme.com',
    logoUrl: null,
    tagline: 'Building great things',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
};

describe('GET /api/org', () => {
    beforeEach(() => {
        mockFindFirst.mockReset();
    });

    it('returns org details when org exists', async () => {
        mockFindFirst.mockResolvedValue(sampleOrg);

        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe('Acme Corp');
        expect(body.email).toBe('support@acme.com');
    });

    it('returns 404 when no org exists', async () => {
        mockFindFirst.mockResolvedValue(null);

        const res = await GET();
        expect(res.status).toBe(404);
    });
});

describe('PUT /api/org', () => {
    beforeEach(() => {
        mockFindFirst.mockReset();
        mockUpdate.mockReset();
        mockGetServerSession.mockReset();
    });

    it('updates org when called by admin', async () => {
        mockGetServerSession.mockResolvedValue({
            user: { id: 'user-1', role: 'ADMIN', memberId: 'user-1' },
        });
        mockFindFirst.mockResolvedValue(sampleOrg);
        mockUpdate.mockResolvedValue({ ...sampleOrg, name: 'New Name', updatedAt: new Date() });

        const res = await PUT(makeRequest({ name: 'New Name' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe('New Name');
    });

    it('returns 401 when not authenticated', async () => {
        mockGetServerSession.mockResolvedValue(null);

        const res = await PUT(makeRequest({ name: 'New Name' }));
        expect(res.status).toBe(401);
    });

    it('returns 403 when user is not admin', async () => {
        mockGetServerSession.mockResolvedValue({
            user: { id: 'user-2', role: 'SUPPORT', memberId: 'user-2' },
        });

        const res = await PUT(makeRequest({ name: 'New Name' }));
        expect(res.status).toBe(403);
    });

    it('validates email format on update', async () => {
        mockGetServerSession.mockResolvedValue({
            user: { id: 'user-1', role: 'ADMIN', memberId: 'user-1' },
        });
        mockFindFirst.mockResolvedValue(sampleOrg);

        const res = await PUT(makeRequest({ email: 'bad-email' }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.errors).toEqual(
            expect.arrayContaining([expect.stringContaining('valid email')]),
        );
    });
});
