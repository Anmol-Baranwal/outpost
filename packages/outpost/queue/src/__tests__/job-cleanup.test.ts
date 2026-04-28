/**
 * Tests for the job cleanup handler.
 *
 * Mocks Prisma to test the handler in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockPrismaJob = {
    deleteMany: vi.fn(),
};

const mockPrismaSyncEvent = {
    deleteMany: vi.fn(),
};

const mockPrisma = {
    job: mockPrismaJob,
    syncEvent: mockPrismaSyncEvent,
};

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: mockPrisma,
}));

// Import after mocks
const { handleJobCleanup } = await import('../handlers/job-cleanup.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-cleanup-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handleJobCleanup', () => {
    beforeEach(() => {
        mockPrismaJob.deleteMany.mockReset();
        mockPrismaSyncEvent.deleteMany.mockReset();
    });

    it('should delete old completed jobs older than 7 days', async () => {
        mockPrismaJob.deleteMany.mockResolvedValue({ count: 15 });
        mockPrismaSyncEvent.deleteMany.mockResolvedValue({ count: 0 });

        const result = await handleJobCleanup({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.completedDeleted).toBe(15);

        // Verify the first deleteMany call targets COMPLETED jobs
        const completedCall = mockPrismaJob.deleteMany.mock.calls[0][0];
        expect(completedCall.where.status).toBe('COMPLETED');
        expect(completedCall.where.completedAt.lt).toBeInstanceOf(Date);

        // The cutoff should be approximately 7 days ago
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const cutoff = completedCall.where.completedAt.lt.getTime();
        const expectedCutoff = Date.now() - sevenDaysMs;
        expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5000); // within 5s
    });

    it('should delete old dead-letter jobs older than 30 days', async () => {
        mockPrismaJob.deleteMany
            .mockResolvedValueOnce({ count: 0 })   // completed
            .mockResolvedValueOnce({ count: 8 });   // dead letter
        mockPrismaSyncEvent.deleteMany.mockResolvedValue({ count: 0 });

        const result = await handleJobCleanup({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.deadLetterDeleted).toBe(8);

        // Verify the second deleteMany call targets DEAD_LETTER jobs
        const deadLetterCall = mockPrismaJob.deleteMany.mock.calls[1][0];
        expect(deadLetterCall.where.status).toBe('DEAD_LETTER');
        expect(deadLetterCall.where.updatedAt.lt).toBeInstanceOf(Date);

        // The cutoff should be approximately 30 days ago
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const cutoff = deadLetterCall.where.updatedAt.lt.getTime();
        const expectedCutoff = Date.now() - thirtyDaysMs;
        expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5000);
    });

    it('should delete old sync events older than 30 days', async () => {
        mockPrismaJob.deleteMany.mockResolvedValue({ count: 0 });
        mockPrismaSyncEvent.deleteMany.mockResolvedValue({ count: 42 });

        const result = await handleJobCleanup({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.syncEventsDeleted).toBe(42);

        // Verify the syncEvent deleteMany call
        const syncCall = mockPrismaSyncEvent.deleteMany.mock.calls[0][0];
        expect(syncCall.where.createdAt.lt).toBeInstanceOf(Date);

        // The cutoff should be approximately 30 days ago
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const cutoff = syncCall.where.createdAt.lt.getTime();
        const expectedCutoff = Date.now() - thirtyDaysMs;
        expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5000);
    });

    it('should keep recent jobs and return zero counts', async () => {
        mockPrismaJob.deleteMany.mockResolvedValue({ count: 0 });
        mockPrismaSyncEvent.deleteMany.mockResolvedValue({ count: 0 });

        const result = await handleJobCleanup({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.completedDeleted).toBe(0);
        expect(result.data?.deadLetterDeleted).toBe(0);
        expect(result.data?.syncEventsDeleted).toBe(0);
    });

    it('should report progress at 33%, 66%, and 100%', async () => {
        mockPrismaJob.deleteMany.mockResolvedValue({ count: 0 });
        mockPrismaSyncEvent.deleteMany.mockResolvedValue({ count: 0 });

        const context = makeContext();
        await handleJobCleanup({}, context);

        expect(context.reportProgress).toHaveBeenCalledWith(33);
        expect(context.reportProgress).toHaveBeenCalledWith(66);
        expect(context.reportProgress).toHaveBeenCalledWith(100);
        expect(context.reportProgress).toHaveBeenCalledTimes(3);
    });

    it('should return combined results from all cleanup phases', async () => {
        mockPrismaJob.deleteMany
            .mockResolvedValueOnce({ count: 100 })  // completed
            .mockResolvedValueOnce({ count: 25 });   // dead letter
        mockPrismaSyncEvent.deleteMany.mockResolvedValue({ count: 50 });

        const result = await handleJobCleanup({}, makeContext());

        expect(result).toEqual({
            success: true,
            data: {
                completedDeleted: 100,
                deadLetterDeleted: 25,
                syncEventsDeleted: 50,
            },
        });
    });
});
