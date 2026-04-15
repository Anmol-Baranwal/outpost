import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
    it('returns status ok with correct shape', async () => {
        const response = await GET();
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body.status).toBe('ok');
        expect(body.service).toBe('web');
        expect(typeof body.version).toBe('string');
        expect(typeof body.uptime).toBe('number');
        expect(body.uptime).toBeGreaterThanOrEqual(0);
    });
});
