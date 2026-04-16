/**
 * Tests for the Linear bulk import script.
 *
 * Mocks both @linear/sdk and Prisma to verify import logic
 * without real API or database calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Setup ────────────────────────────────────────────────────────────

// We test importLinearIssues directly by importing the function.
// Since the script uses @linear/sdk and @prisma/client, we mock them.

vi.mock('@linear/sdk', () => ({
    LinearClient: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
    PrismaClient: vi.fn(),
}));

// Import after mocks are set up
import { importLinearIssues } from '../import-linear.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeIssue(overrides: Record<string, unknown> = {}) {
    return {
        id: 'issue-1',
        identifier: 'LIN-1',
        title: 'Test Issue',
        description: 'Test description',
        url: 'https://linear.app/team/issue/LIN-1',
        priority: 3,
        state: Promise.resolve({ name: 'In Progress' }),
        labels: vi.fn().mockResolvedValue({ nodes: [{ name: 'Bug' }] }),
        comments: vi.fn().mockResolvedValue({
            nodes: [
                {
                    body: 'First comment',
                    user: Promise.resolve({ name: 'Alice' }),
                },
            ],
        }),
        attachments: vi.fn().mockResolvedValue({ nodes: [] }),
        ...overrides,
    };
}

function makeMockLinearClient(issues: ReturnType<typeof makeIssue>[] = [makeIssue()]) {
    return {
        issues: vi.fn().mockResolvedValue({
            nodes: issues,
            pageInfo: { hasNextPage: false, endCursor: null },
        }),
    };
}

function makeMockPrisma() {
    return {
        ticket: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(({ data }: { data: { displayId: string } }) =>
                Promise.resolve({ id: `ticket-${data.displayId}` }),
            ),
        },
        ticketExternalLink: {
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'link-1' }),
        },
        message: {
            create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
        },
        $disconnect: vi.fn().mockResolvedValue(undefined),
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('importLinearIssues', () => {
    let mockLinear: ReturnType<typeof makeMockLinearClient>;
    let mockPrisma: ReturnType<typeof makeMockPrisma>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLinear = makeMockLinearClient();
        mockPrisma = makeMockPrisma();
    });

    it('creates tickets with correct data', async () => {
        const report = await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: false, since: null },
        );

        expect(report.created).toBe(1);
        expect(report.failed).toBe(0);

        // Ticket was created
        expect(mockPrisma.ticket.create).toHaveBeenCalledTimes(1);
        const ticketData = (mockPrisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
        expect(ticketData.title).toBe('Test Issue');
        expect(ticketData.description).toBe('Test description');
        expect(ticketData.status).toBe('IN_PROGRESS');
        expect(ticketData.priority).toBe('MEDIUM'); // priority 3 → MEDIUM

        // External link was created
        expect(mockPrisma.ticketExternalLink.create).toHaveBeenCalledTimes(1);
        const linkData = (mockPrisma.ticketExternalLink.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
        expect(linkData.plugin).toBe('linear');
        expect(linkData.externalId).toBe('issue-1');

        // Comment was imported
        expect(mockPrisma.message.create).toHaveBeenCalledTimes(1);
        const msgData = (mockPrisma.message.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
        expect(msgData.content).toBe('First comment');
        expect(msgData.author).toBe('Alice');
    });

    it('skips already-linked issues', async () => {
        mockPrisma.ticketExternalLink.findUnique = vi.fn().mockResolvedValue({
            id: 'existing-link',
            ticketId: 'existing-ticket',
        });

        const report = await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: false, since: null },
        );

        expect(report.skipped).toBe(1);
        expect(report.created).toBe(0);
        expect(mockPrisma.ticket.create).not.toHaveBeenCalled();
    });

    it('matches via GitHub cross-reference', async () => {
        const issueWithAttachment = makeIssue({
            attachments: vi.fn().mockResolvedValue({
                nodes: [{ url: 'https://github.com/org/repo/issues/42' }],
            }),
        });
        mockLinear = makeMockLinearClient([issueWithAttachment]);

        // Simulate finding a GitHub-linked ticket
        mockPrisma.ticketExternalLink.findFirst = vi.fn().mockResolvedValue({
            ticketId: 'github-ticket-1',
        });

        const report = await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: false, since: null },
        );

        expect(report.matched).toBe(1);
        expect(report.created).toBe(0);

        // Should create the link to the existing ticket
        expect(mockPrisma.ticketExternalLink.create).toHaveBeenCalledTimes(1);
        const linkData = (mockPrisma.ticketExternalLink.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
        expect(linkData.ticketId).toBe('github-ticket-1');
        expect(linkData.plugin).toBe('linear');
    });

    it('dry-run does not write to database', async () => {
        const report = await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: true, since: null },
        );

        expect(report.created).toBe(1);
        expect(mockPrisma.ticket.create).not.toHaveBeenCalled();
        expect(mockPrisma.ticketExternalLink.create).not.toHaveBeenCalled();
        expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });

    it('handles pagination', async () => {
        const issue1 = makeIssue({ id: 'issue-1', identifier: 'LIN-1' });
        const issue2 = makeIssue({ id: 'issue-2', identifier: 'LIN-2' });

        mockLinear.issues = vi.fn()
            .mockResolvedValueOnce({
                nodes: [issue1],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            })
            .mockResolvedValueOnce({
                nodes: [issue2],
                pageInfo: { hasNextPage: false, endCursor: null },
            });

        const report = await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: false, since: null },
        );

        expect(report.created).toBe(2);
        expect(mockLinear.issues).toHaveBeenCalledTimes(2);
    });

    it('counts failures and continues', async () => {
        mockPrisma.ticket.create = vi.fn().mockRejectedValue(new Error('DB error'));

        const report = await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: false, since: null },
        );

        expect(report.failed).toBe(1);
        expect(report.errors).toHaveLength(1);
        expect(report.errors[0].message).toBe('DB error');
    });

    it('passes since filter to Linear API', async () => {
        const sinceDate = new Date('2024-06-01');

        await importLinearIssues(
            mockLinear as never,
            mockPrisma as never,
            { teamId: 'team-1', dryRun: false, since: sinceDate },
        );

        expect(mockLinear.issues).toHaveBeenCalledWith(
            expect.objectContaining({
                filter: expect.objectContaining({
                    createdAt: { gte: sinceDate },
                }),
            }),
        );
    });
});
