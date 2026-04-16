/**
 * Tests for the account scoring job handler.
 *
 * Mocks Prisma and the AI package to test the handler in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockPrismaAccount = {
    findMany: vi.fn(),
    update: vi.fn(),
};

const mockPrismaMessage = {
    findMany: vi.fn(),
};

const mockPrismaTicket = {
    count: vi.fn(),
};

const mockPrisma = {
    account: mockPrismaAccount,
    message: mockPrismaMessage,
    ticket: mockPrismaTicket,
};

vi.mock('@copilotkit/outpost-db', () => ({
    prisma: mockPrisma,
}));

const mockAnalyzeSentiment = vi.fn();
const mockScoreEngagement = vi.fn();

vi.mock('@copilotkit/outpost-ai', () => ({
    analyzeSentiment: (...args: unknown[]) => mockAnalyzeSentiment(...args),
    scoreEngagement: (...args: unknown[]) => mockScoreEngagement(...args),
}));

// Import after mocks
const { handleAccountScoring } = await import('../handlers/account-scoring.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-job-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handleAccountScoring', () => {
    beforeEach(() => {
        mockPrismaAccount.findMany.mockReset();
        mockPrismaAccount.update.mockReset();
        mockPrismaMessage.findMany.mockReset();
        mockPrismaTicket.count.mockReset();
        mockAnalyzeSentiment.mockReset();
        mockScoreEngagement.mockReset();
    });

    it('should return success with zero scored when no accounts exist', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([]);

        const result = await handleAccountScoring({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.scored).toBe(0);
    });

    it('should score all accounts when no accountId is specified', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([
            { id: 'acct-1', name: 'Acme Corp' },
            { id: 'acct-2', name: 'Widgets Inc' },
        ]);

        mockPrismaMessage.findMany.mockResolvedValue([
            { content: 'Help me', createdAt: new Date() },
        ]);
        mockPrismaTicket.count.mockResolvedValue(3);

        mockAnalyzeSentiment.mockResolvedValue({
            score: 30,
            label: 'NEUTRAL',
            tokenUsage: { inputTokens: 100, outputTokens: 20 },
        });
        mockScoreEngagement.mockReturnValue({
            score: 55,
            level: 'MEDIUM',
        });

        mockPrismaAccount.update.mockResolvedValue({});

        const result = await handleAccountScoring({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.scored).toBe(2);
        expect(result.data?.total).toBe(2);
        expect(mockPrismaAccount.findMany).toHaveBeenCalledWith({
            where: undefined,
            select: { id: true, name: true },
        });
        expect(mockPrismaAccount.update).toHaveBeenCalledTimes(2);
    });

    it('should score only the specified account when accountId is provided', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([
            { id: 'acct-1', name: 'Acme Corp' },
        ]);

        mockPrismaMessage.findMany.mockResolvedValue([]);
        mockPrismaTicket.count.mockResolvedValue(0);

        mockAnalyzeSentiment.mockResolvedValue({
            score: 50,
            label: 'NEUTRAL',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
        });
        mockScoreEngagement.mockReturnValue({
            score: 5,
            level: 'INACTIVE',
        });

        mockPrismaAccount.update.mockResolvedValue({});

        const result = await handleAccountScoring({ accountId: 'acct-1' }, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.scored).toBe(1);
        expect(mockPrismaAccount.findMany).toHaveBeenCalledWith({
            where: { id: 'acct-1' },
            select: { id: true, name: true },
        });
    });

    it('should map sentiment labels to Prisma AccountSentiment enum values', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([
            { id: 'acct-1', name: 'Test' },
        ]);

        mockPrismaMessage.findMany.mockResolvedValue([
            { content: 'angry message', createdAt: new Date() },
        ]);
        mockPrismaTicket.count.mockResolvedValue(5);

        mockAnalyzeSentiment.mockResolvedValue({
            score: 75,
            label: 'CRITICAL',
            tokenUsage: { inputTokens: 100, outputTokens: 20 },
        });
        mockScoreEngagement.mockReturnValue({
            score: 70,
            level: 'HIGH',
        });

        mockPrismaAccount.update.mockResolvedValue({});

        await handleAccountScoring({}, makeContext());

        expect(mockPrismaAccount.update).toHaveBeenCalledWith({
            where: { id: 'acct-1' },
            data: {
                sentiment: 'CHURNING', // CRITICAL maps to CHURNING
                engagement: 'HIGH',
            },
        });
    });

    it('should handle errors for individual accounts gracefully', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([
            { id: 'acct-1', name: 'Good Account' },
            { id: 'acct-2', name: 'Bad Account' },
        ]);

        // First account succeeds
        mockPrismaMessage.findMany
            .mockResolvedValueOnce([{ content: 'hello', createdAt: new Date() }])
            // Second account's message fetch throws
            .mockRejectedValueOnce(new Error('DB connection lost'));

        mockPrismaTicket.count.mockResolvedValue(1);

        mockAnalyzeSentiment.mockResolvedValue({
            score: 30,
            label: 'NEUTRAL',
            tokenUsage: { inputTokens: 100, outputTokens: 20 },
        });
        mockScoreEngagement.mockReturnValue({
            score: 50,
            level: 'MEDIUM',
        });

        mockPrismaAccount.update.mockResolvedValue({});

        const result = await handleAccountScoring({}, makeContext());

        // One succeeded, one failed
        expect(result.success).toBe(false);
        expect(result.data?.scored).toBe(1);
        expect(result.data?.total).toBe(2);
        expect(result.error).toContain('1 accounts failed');
    });

    it('should report progress throughout processing', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([
            { id: 'acct-1', name: 'Test' },
        ]);
        mockPrismaMessage.findMany.mockResolvedValue([]);
        mockPrismaTicket.count.mockResolvedValue(0);
        mockAnalyzeSentiment.mockResolvedValue({
            score: 50,
            label: 'NEUTRAL',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
        });
        mockScoreEngagement.mockReturnValue({ score: 5, level: 'INACTIVE' });
        mockPrismaAccount.update.mockResolvedValue({});

        const context = makeContext();
        await handleAccountScoring({}, context);

        // Should have called reportProgress multiple times
        expect(context.reportProgress).toHaveBeenCalledWith(5);
        expect(context.reportProgress).toHaveBeenCalledWith(100);
    });

    it('should only analyze USER type messages, not bot or system', async () => {
        mockPrismaAccount.findMany.mockResolvedValue([
            { id: 'acct-1', name: 'Test' },
        ]);

        mockPrismaMessage.findMany.mockResolvedValue([]);
        mockPrismaTicket.count.mockResolvedValue(0);
        mockAnalyzeSentiment.mockResolvedValue({
            score: 50,
            label: 'NEUTRAL',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
        });
        mockScoreEngagement.mockReturnValue({ score: 5, level: 'INACTIVE' });
        mockPrismaAccount.update.mockResolvedValue({});

        await handleAccountScoring({}, makeContext());

        // Verify the message query filters for USER type
        expect(mockPrismaMessage.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    type: 'USER',
                }),
            }),
        );
    });
});
