import { describe, it, expect, vi } from 'vitest';
import { getFeedbackCalibration } from '../feedback-calibration.js';

function mockPrisma(counts: { POSITIVE: number; NEGATIVE: number }) {
    return {
        message: {
            count: vi.fn(async ({ where }: { where: { feedback: string } }) =>
                where.feedback === 'POSITIVE' ? counts.POSITIVE : counts.NEGATIVE,
            ),
        },
    };
}

describe('getFeedbackCalibration', () => {
    it('counts POSITIVE and NEGATIVE AI-message feedback with the right filters', async () => {
        const prisma = mockPrisma({ POSITIVE: 300, NEGATIVE: 300 });
        await getFeedbackCalibration(prisma);

        expect(prisma.message.count).toHaveBeenCalledWith({
            where: { isAiGenerated: true, feedback: 'POSITIVE' },
        });
        expect(prisma.message.count).toHaveBeenCalledWith({
            where: { isAiGenerated: true, feedback: 'NEGATIVE' },
        });
    });

    it('returns a positive factor when positives dominate (above threshold)', async () => {
        const prisma = mockPrisma({ POSITIVE: 500, NEGATIVE: 0 });
        expect(await getFeedbackCalibration(prisma)).toBeCloseTo(0.15, 5);
    });

    it('returns 0 below the min-sample threshold', async () => {
        const prisma = mockPrisma({ POSITIVE: 5, NEGATIVE: 3 });
        expect(await getFeedbackCalibration(prisma)).toBe(0);
    });

    it('propagates DB errors (does not swallow)', async () => {
        const prisma = {
            message: {
                count: vi.fn(async () => {
                    throw new Error('db down');
                }),
            },
        };
        await expect(getFeedbackCalibration(prisma)).rejects.toThrow('db down');
    });
});
