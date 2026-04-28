import { describe, it, expect, vi } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockQueryRawUnsafe = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        $queryRawUnsafe: (...args: unknown[]) => mockQueryRawUnsafe(...args),
    },
}));

// Import after mocks
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
    it('returns status ok with correct shape', async () => {
        mockQueryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);

        const response = await GET();
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body.status).toBe('ok');
        expect(body.service).toBe('web');
        expect(typeof body.version).toBe('string');
        expect(typeof body.uptime).toBe('number');
        expect(body.uptime).toBeGreaterThanOrEqual(0);
        expect(body.database).toBe('connected');
    });

    it('returns degraded when database is unreachable', async () => {
        mockQueryRawUnsafe.mockRejectedValue(new Error('Connection refused'));

        const response = await GET();
        expect(response.status).toBe(503);

        const body = await response.json();
        expect(body.status).toBe('degraded');
        expect(body.database).toBe('unreachable');
    });
});
