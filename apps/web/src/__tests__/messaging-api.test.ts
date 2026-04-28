import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Import after mocks
import { GET as getStats } from '@/app/api/messaging/stats/route';
import { GET as getPending } from '@/app/api/messaging/pending/route';

// ─── Helpers ────────────────────────────────────────────────────────────────

function userSession(memberId = 'tm-1') {
    return {
        user: {
            id: memberId,
            name: 'Test User',
            email: 'test@test.com',
            role: 'MEMBER',
            memberId,
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/messaging/stats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns default stats', async () => {
        const res = await getStats();
        const body = await res.json();

        expect(body.totalPending).toBe(0);
        expect(body.overdueCount).toBe(0);
        expect(body.slackCount).toBe(0);
        expect(body.teamsCount).toBe(0);
        expect(body.avgResponseTimeMs).toBe(0);
    });
});

describe('GET /api/messaging/pending', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns empty messages list', async () => {
        const res = await getPending();
        const body = await res.json();

        expect(body.messages).toHaveLength(0);
        expect(body.count).toBe(0);
    });
});
