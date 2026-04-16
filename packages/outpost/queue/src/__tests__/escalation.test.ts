/**
 * Tests for the escalation job handler.
 *
 * Uses mocked Prisma and mocked routing engine to test the handler
 * in isolation. Follows red-green discipline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockPrismaTicket = {
    findUnique: vi.fn(),
    update: vi.fn(),
};

const mockPrismaNote = {
    create: vi.fn(),
};

const mockPrismaTeamMember = {
    findMany: vi.fn(),
};

const mockPrisma = {
    ticket: mockPrismaTicket,
    note: mockPrismaNote,
    teamMember: mockPrismaTeamMember,
};

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: mockPrisma,
}));

// Mock the shared package routing
const mockEvaluateRouting = vi.fn();
vi.mock('@copilotkit/outpost/shared', () => ({
    evaluateRouting: (...args: unknown[]) => mockEvaluateRouting(...args),
    TeamMemberRole: {
        ADMIN: 'ADMIN',
        MEMBER: 'MEMBER',
    },
}));

// Import after mocks
const { handleEscalation } = await import('../handlers/escalation.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-job-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

const sampleTicket = {
    id: 'tkt-1',
    title: 'Need help with billing',
    description: 'Cannot update payment method',
    source: 'DISCORD',
    type: 'ACCOUNT_ISSUE',
    priority: 'HIGH',
    status: 'OPEN',
    account: {
        id: 'acct-1',
        acv: 75000,
        owner: 'Alice',
    },
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handleEscalation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrismaTicket.update.mockResolvedValue({});
        mockPrismaNote.create.mockResolvedValue({});
    });

    it('returns failure when ticket is not found', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(null);

        const result = await handleEscalation(
            { ticketId: 'nonexistent', reason: 'test' },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('uses routing engine when no targetTeamMemberId is specified', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([
            { id: 'admin-1', name: 'Alice', role: 'ADMIN' },
            { id: 'eng-1', name: 'Bob', role: 'MEMBER' },
        ]);
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: 'admin-1',
            matchedRule: { name: 'billing-to-sales' },
            confidence: 0.8,
            reason: 'Matched billing keywords',
        });

        const result = await handleEscalation(
            { ticketId: 'tkt-1', reason: 'AI confidence too low' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.assigneeId).toBe('admin-1');
        expect(mockEvaluateRouting).toHaveBeenCalledOnce();
    });

    it('updates ticket assignee in the database', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([]);
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: 'eng-1',
            matchedRule: null,
            confidence: 0.3,
            reason: 'Fallback to on-call',
        });

        await handleEscalation(
            { ticketId: 'tkt-1', reason: 'needs human' },
            makeContext(),
        );

        expect(mockPrismaTicket.update).toHaveBeenCalledWith({
            where: { id: 'tkt-1' },
            data: {
                assigneeId: 'eng-1',
                status: 'IN_PROGRESS',
            },
        });
    });

    it('creates a note documenting the routing decision', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([]);
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: 'eng-1',
            matchedRule: { name: 'test-rule' },
            confidence: 0.8,
            reason: 'Test routing reason',
        });

        await handleEscalation(
            { ticketId: 'tkt-1', reason: 'low confidence' },
            makeContext(),
        );

        expect(mockPrismaNote.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'tkt-1',
                author: 'system',
                content: expect.stringContaining('low confidence'),
            }),
        });
    });

    it('uses targetTeamMemberId directly when provided', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        const result = await handleEscalation(
            {
                ticketId: 'tkt-1',
                reason: 'user requested specific agent',
                targetTeamMemberId: 'specific-member',
            },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.assigneeId).toBe('specific-member');
        // Should NOT call the routing engine
        expect(mockEvaluateRouting).not.toHaveBeenCalled();
    });

    it('reports progress throughout execution', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([]);
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: null,
            matchedRule: null,
            confidence: 0.3,
            reason: 'No match',
        });

        const ctx = makeContext();
        await handleEscalation(
            { ticketId: 'tkt-1', reason: 'test' },
            ctx,
        );

        // Should have reported progress multiple times
        expect(ctx.reportProgress).toHaveBeenCalledWith(10);
        expect(ctx.reportProgress).toHaveBeenCalledWith(30);
        expect(ctx.reportProgress).toHaveBeenCalledWith(100);
    });

    it('handles null assignee gracefully', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([]);
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: null,
            matchedRule: null,
            confidence: 0.3,
            reason: 'No routing rule matched and no on-call configured',
        });

        const result = await handleEscalation(
            { ticketId: 'tkt-1', reason: 'escalated' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.assigneeId).toBeNull();

        // Should still update ticket (assigneeId = null, status = IN_PROGRESS)
        expect(mockPrismaTicket.update).toHaveBeenCalledWith({
            where: { id: 'tkt-1' },
            data: {
                assigneeId: null,
                status: 'IN_PROGRESS',
            },
        });

        // Note should mention unassigned
        expect(mockPrismaNote.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                content: expect.stringContaining('unassigned'),
            }),
        });
    });
});
