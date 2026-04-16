/**
 * Tests for the TRACKER_SYNC job handler.
 *
 * Uses mocked Prisma, mocked SyncEngine, and mocked plugins
 * to test the handler in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';

// ─── Mock Setup ────────────────────────────────────────────────────────────

const mockPrismaTicketExternalLink = {
    findUnique: vi.fn(),
};

const mockPrisma = {
    ticketExternalLink: mockPrismaTicketExternalLink,
};

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: mockPrisma,
}));

// Mock SyncEngine methods — we pass a real-ish engine to the factory
const mockGetPlugin = vi.fn();
const mockIsInternalTracker = vi.fn().mockReturnValue(false);
const mockComputeHash = vi.fn().mockReturnValue('abc123hash');
const mockIsEchoEvent = vi.fn().mockResolvedValue(false);
const mockRecordSyncEvent = vi.fn().mockResolvedValue(undefined);

const mockEngine = {
    getPlugin: mockGetPlugin,
    isInternalTracker: mockIsInternalTracker,
    computeHash: mockComputeHash,
    isEchoEvent: mockIsEchoEvent,
    recordSyncEvent: mockRecordSyncEvent,
};

// We need to mock the shared module to avoid type import issues
vi.mock('@copilotkit/outpost/shared', () => ({
    TicketStatus: {
        OPEN: 'OPEN',
        IN_PROGRESS: 'IN_PROGRESS',
        RESOLVED: 'RESOLVED',
        CLOSED: 'CLOSED',
    },
    TicketPriority: {
        CRITICAL: 'CRITICAL',
        HIGH: 'HIGH',
        MEDIUM: 'MEDIUM',
        LOW: 'LOW',
    },
}));

// Import after mocks
const { createTrackerSyncHandler } = await import('../handlers/tracker-sync.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-job-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

const sampleLink = {
    id: 'link-1',
    ticketId: 'tkt-1',
    plugin: 'github',
    externalId: 'gh-42',
    externalUrl: 'https://github.com/org/repo/issues/42',
    metadata: null,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handleTrackerSync', () => {
    let handler: ReturnType<typeof createTrackerSyncHandler>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Cast to satisfy the type — tests only exercise the methods we mock
        handler = createTrackerSyncHandler(mockEngine as never);
    });

    it('returns error when plugin is not registered', async () => {
        mockGetPlugin.mockReturnValue(undefined);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'nonexistent',
                action: 'status_change',
                changeData: { status: 'RESOLVED' },
            },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('not registered');
    });

    it('returns error when no external link exists', async () => {
        mockGetPlugin.mockReturnValue({ name: 'github' });
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(null);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'comment',
                changeData: { comment: 'hello' },
            },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('No external link found');
    });

    it('skips push when echo is detected', async () => {
        const mockPlugin = {
            name: 'github',
            pushStatusChange: vi.fn(),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(true);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'status_change',
                changeData: { status: 'RESOLVED' },
            },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ skipped: true, reason: 'echo detected' });
        expect(mockPlugin.pushStatusChange).not.toHaveBeenCalled();
    });

    it('pushes status_change and records success', async () => {
        const mockPlugin = {
            name: 'github',
            pushStatusChange: vi.fn().mockResolvedValue(undefined),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(false);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'status_change',
                changeData: { status: 'RESOLVED' },
            },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(mockPlugin.pushStatusChange).toHaveBeenCalledWith(
            expect.objectContaining({ externalId: 'gh-42' }),
            'RESOLVED',
        );
        expect(mockRecordSyncEvent).toHaveBeenCalledWith(
            'outpost', 'github', 'ticket', 'tkt-1',
            'status_change', 'abc123hash', 'success',
        );
    });

    it('pushes comment and records success', async () => {
        const mockPlugin = {
            name: 'github',
            pushComment: vi.fn().mockResolvedValue(undefined),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(false);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'comment',
                changeData: { comment: 'Fixed in v2.0' },
            },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(mockPlugin.pushComment).toHaveBeenCalledWith(
            expect.objectContaining({ externalId: 'gh-42' }),
            'Fixed in v2.0',
        );
    });

    it('pushes labels and records success', async () => {
        const mockPlugin = {
            name: 'github',
            pushLabels: vi.fn().mockResolvedValue(undefined),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(false);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'label_change',
                changeData: { labels: ['bug', 'p1'] },
            },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(mockPlugin.pushLabels).toHaveBeenCalledWith(
            expect.objectContaining({ externalId: 'gh-42' }),
            ['bug', 'p1'],
        );
    });

    it('records failure when plugin push throws', async () => {
        const mockPlugin = {
            name: 'github',
            pushStatusChange: vi.fn().mockRejectedValue(new Error('API 500')),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(false);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'status_change',
                changeData: { status: 'CLOSED' },
            },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('API 500');
        expect(mockRecordSyncEvent).toHaveBeenCalledWith(
            'outpost', 'github', 'ticket', 'tkt-1',
            'status_change', 'abc123hash', 'failure', 'API 500',
        );
    });

    it('handles assignee_change for internal tracker', async () => {
        const mockPlugin = {
            name: 'linear',
            pushAssignee: vi.fn().mockResolvedValue(undefined),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockIsInternalTracker.mockReturnValue(true);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue({
            ...sampleLink,
            plugin: 'linear',
            externalId: 'lin-99',
        });
        mockIsEchoEvent.mockResolvedValue(false);

        const member = { id: 'tm-1', name: 'Alice', email: 'alice@example.com' };

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'linear',
                action: 'assignee_change',
                changeData: { member },
            },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(mockPlugin.pushAssignee).toHaveBeenCalledWith(
            expect.objectContaining({ externalId: 'lin-99' }),
            member,
        );
    });

    it('returns error for unknown action', async () => {
        const mockPlugin = { name: 'github' };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(false);

        const result = await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'unknown_action',
                changeData: {},
            },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown sync action');
    });

    it('reports progress throughout execution', async () => {
        const mockPlugin = {
            name: 'github',
            pushComment: vi.fn().mockResolvedValue(undefined),
        };
        mockGetPlugin.mockReturnValue(mockPlugin);
        mockPrismaTicketExternalLink.findUnique.mockResolvedValue(sampleLink);
        mockIsEchoEvent.mockResolvedValue(false);

        const ctx = makeContext();
        await handler(
            {
                ticketId: 'tkt-1',
                targetPlugin: 'github',
                action: 'comment',
                changeData: { comment: 'test' },
            },
            ctx,
        );

        // Should have called reportProgress multiple times
        expect(vi.mocked(ctx.reportProgress).mock.calls.length).toBeGreaterThanOrEqual(4);
    });
});
