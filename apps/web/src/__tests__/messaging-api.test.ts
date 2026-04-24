import { describe, it, expect } from 'vitest';

// No mocks needed — messaging routes return sensible defaults (no DB model yet)

import { GET as getStats } from '@/app/api/messaging/stats/route';
import { GET as getPending } from '@/app/api/messaging/pending/route';

describe('GET /api/messaging/stats', () => {
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
    it('returns empty messages list', async () => {
        const res = await getPending();
        const body = await res.json();

        expect(body.messages).toHaveLength(0);
        expect(body.count).toBe(0);
    });
});
