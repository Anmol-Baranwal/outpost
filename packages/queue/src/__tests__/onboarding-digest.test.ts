import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the handler
const mockOnboardingMember = {
    findMany: vi.fn(),
};

vi.mock('@copilotkit/outpost-db', () => ({
    prisma: {
        onboardingMember: mockOnboardingMember,
    },
}));

vi.mock('@copilotkit/outpost-shared', () => ({
    computeFunnelMetrics: vi.fn().mockReturnValue({
        stageCounts: { JOINED: 3, CONTACTED: 2, RESPONDED: 1, MEETING_BOOKED: 0 },
        conversionRates: {
            joinedToContacted: 66.67,
            contactedToResponded: 50,
            respondedToMeetingBooked: 0,
        },
        totalMembers: 3,
    }),
}));

const { handleOnboardingDigest } = await import('../handlers/onboarding-digest.js');

function makeContext() {
    return {
        jobId: 'job-digest-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

function makeMemberRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'om-1',
        discordId: 'discord-001',
        username: 'alice#1234',
        joinedAt: new Date('2026-04-15T10:00:00Z'),
        funnelStage: 'JOINED',
        contacted: false,
        responded: false,
        meetingBooked: false,
        createdAt: new Date('2026-04-15T10:00:00Z'),
        updatedAt: new Date('2026-04-15T10:00:00Z'),
        ...overrides,
    };
}

describe('handleOnboardingDigest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('queries members for the given date range', async () => {
        mockOnboardingMember.findMany
            .mockResolvedValueOnce([makeMemberRow()])  // date-filtered query
            .mockResolvedValueOnce([makeMemberRow()]); // all-members query for metrics

        const ctx = makeContext();
        const result = await handleOnboardingDigest({ date: '2026-04-15' }, ctx);

        expect(result.success).toBe(true);
        expect(result.data?.date).toBe('2026-04-15');
        expect(result.data?.newMemberCount).toBe(1);

        // First call should filter by date range
        const firstCall = mockOnboardingMember.findMany.mock.calls[0][0];
        expect(firstCall.where.joinedAt.gte).toBeInstanceOf(Date);
        expect(firstCall.where.joinedAt.lt).toBeInstanceOf(Date);
    });

    it('handles zero new members gracefully', async () => {
        mockOnboardingMember.findMany
            .mockResolvedValueOnce([])   // no members for the day
            .mockResolvedValueOnce([]);  // no members overall

        const ctx = makeContext();
        const result = await handleOnboardingDigest({ date: '2026-04-15' }, ctx);

        expect(result.success).toBe(true);
        expect(result.data?.newMemberCount).toBe(0);
    });

    it('reports progress through the job lifecycle', async () => {
        mockOnboardingMember.findMany.mockResolvedValue([]);

        const ctx = makeContext();
        await handleOnboardingDigest({ date: '2026-04-15' }, ctx);

        const progressCalls = ctx.reportProgress.mock.calls.map(
            (c: number[]) => c[0],
        );
        expect(progressCalls).toEqual([10, 50, 70, 90, 100]);
    });

    it('defaults to current date when payload date is empty', async () => {
        mockOnboardingMember.findMany.mockResolvedValue([]);

        const ctx = makeContext();
        const result = await handleOnboardingDigest({ date: '' }, ctx);

        expect(result.success).toBe(true);
        // The date should be today's date
        expect(result.data?.date).toBe(new Date().toISOString().split('T')[0]);
    });

    it('compiles digest with multiple new members', async () => {
        const members = [
            makeMemberRow({ id: 'om-1', username: 'alice#1234' }),
            makeMemberRow({ id: 'om-2', username: 'bob#5678' }),
            makeMemberRow({ id: 'om-3', username: 'charlie#9012' }),
        ];

        mockOnboardingMember.findMany
            .mockResolvedValueOnce(members)
            .mockResolvedValueOnce(members);

        const ctx = makeContext();
        const result = await handleOnboardingDigest({ date: '2026-04-15' }, ctx);

        expect(result.success).toBe(true);
        expect(result.data?.newMemberCount).toBe(3);
    });
});
