/**
 * Tests for notification dispatch in escalation and SLA check handlers.
 *
 * Validates that:
 * - Escalation handler posts a notification system message
 * - SLA check handler posts a breach notification message
 * - Notification failures don't fail the main job
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';
import { JobType } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockPrismaTicket = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
};

const mockPrismaNote = {
    create: vi.fn(),
};

const mockPrismaMessage = {
    create: vi.fn(),
};

const mockPrismaTeamMember = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
};

const mockPrismaSlaConfig = {
    findMany: vi.fn(),
};

const mockPrisma = {
    ticket: mockPrismaTicket,
    note: mockPrismaNote,
    message: mockPrismaMessage,
    teamMember: mockPrismaTeamMember,
    slaConfig: mockPrismaSlaConfig,
    $transaction: vi.fn(),
};

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: mockPrisma,
}));

const mockEvaluateRouting = vi.fn();
vi.mock('@copilotkit/outpost/shared', () => ({
    evaluateRouting: (...args: unknown[]) => mockEvaluateRouting(...args),
    TeamMemberRole: {
        ADMIN: 'ADMIN',
        MEMBER: 'MEMBER',
    },
    loadSlaConfig: vi.fn().mockResolvedValue({
        CRITICAL: { firstResponseMinutes: 15, resolutionMinutes: 240 },
        HIGH: { firstResponseMinutes: 60, resolutionMinutes: 480 },
        MEDIUM: { firstResponseMinutes: 240, resolutionMinutes: 2880 },
        LOW: { firstResponseMinutes: 1440, resolutionMinutes: 10080 },
    }),
    checkSlaCompliance: vi.fn().mockReturnValue({
        firstResponseBreached: true,
        resolutionBreached: false,
        target: { firstResponseMinutes: 60, resolutionMinutes: 480 },
    }),
    formatDuration: vi.fn().mockReturnValue('1 hour'),
}));

// Import after mocks
const { handleEscalation } = await import('../handlers/escalation.js');
const { handleSlaCheck } = await import('../handlers/sla-check.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-job-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

const sampleTicket = {
    id: 'tkt-1',
    displayId: 'TKT-0001',
    title: 'Need help',
    description: 'Something is broken',
    source: 'DISCORD',
    type: 'BUG',
    priority: 'HIGH',
    status: 'OPEN',
    slaBreachedAt: null,
    createdAt: new Date('2026-04-23T10:00:00Z'),
    account: {
        id: 'acct-1',
        acv: 50000,
        owner: 'Alice',
    },
    messages: [
        { type: 'USER', createdAt: new Date('2026-04-23T10:00:00Z') },
    ],
};

// ─── Escalation Notification Tests ─────────────────────────────────────────

describe('Escalation notification dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrismaTicket.update.mockResolvedValue({});
        mockPrismaNote.create.mockResolvedValue({});
        mockPrismaMessage.create.mockResolvedValue({});
    });

    it('creates a system message notification after escalation', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([
            { id: 'eng-1', name: 'Bob', role: 'MEMBER' },
        ]);
        mockPrismaTeamMember.findUnique.mockResolvedValue({ name: 'Bob' });
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: 'eng-1',
            matchedRule: null,
            confidence: 0.8,
            reason: 'Matched skill keywords',
        });

        const result = await handleEscalation(
            { ticketId: 'tkt-1', reason: 'Low AI confidence' },
            makeContext(),
        );

        expect(result.success).toBe(true);

        // Should have created a notification message
        const messageCalls = mockPrismaMessage.create.mock.calls;
        expect(messageCalls.length).toBeGreaterThanOrEqual(1);

        // Find the notification message call
        const notificationCall = messageCalls.find(
            (call: Array<Record<string, Record<string, unknown>>>) =>
                call[0].data.type === 'SYSTEM' &&
                (call[0].data.content as string).includes('escalated'),
        );
        expect(notificationCall).toBeDefined();
        expect(notificationCall![0].data.content).toContain('TKT-0001');
        expect(notificationCall![0].data.content).toContain('Bob');
    });

    it('escalation succeeds even if notification fails', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([
            { id: 'eng-1', name: 'Bob', role: 'MEMBER' },
        ]);
        mockPrismaTeamMember.findUnique.mockResolvedValue({ name: 'Bob' });
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: 'eng-1',
            matchedRule: null,
            confidence: 0.8,
            reason: 'Test',
        });

        // Make the notification message.create fail
        // Note: first call to message.create is the notification, but it's after note.create
        mockPrismaMessage.create.mockRejectedValue(new Error('DB connection lost'));

        const result = await handleEscalation(
            { ticketId: 'tkt-1', reason: 'test escalation' },
            makeContext(),
        );

        // Escalation itself should still succeed
        expect(result.success).toBe(true);
        expect(result.data?.assigneeId).toBe('eng-1');

        // Ticket update and note should still have been called
        expect(mockPrismaTicket.update).toHaveBeenCalled();
        expect(mockPrismaNote.create).toHaveBeenCalled();
    });

    it('notification includes assignee name when available', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaTeamMember.findMany.mockResolvedValue([]);
        mockPrismaTeamMember.findUnique.mockResolvedValue({ name: 'Alice Smith' });
        mockEvaluateRouting.mockReturnValue({
            targetMemberId: 'admin-1',
            matchedRule: null,
            confidence: 0.9,
            reason: 'ACV routing',
        });

        await handleEscalation(
            { ticketId: 'tkt-1', reason: 'high ACV' },
            makeContext(),
        );

        const messageCalls = mockPrismaMessage.create.mock.calls;
        const notificationCall = messageCalls.find(
            (call: Array<Record<string, Record<string, unknown>>>) =>
                call[0].data.type === 'SYSTEM' &&
                (call[0].data.content as string).includes('escalated'),
        );
        expect(notificationCall).toBeDefined();
        expect(notificationCall![0].data.content).toContain('Alice Smith');
    });
});

// ─── SLA Breach Notification Tests ─────────────────────────────────────────

describe('SLA check notification dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrismaMessage.create.mockResolvedValue({});
        mockPrisma.$transaction.mockResolvedValue([{}, {}]);
    });

    it('creates a system message when flagging a breach', async () => {
        mockPrismaTicket.findMany.mockResolvedValue([sampleTicket]);

        const result = await handleSlaCheck({}, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.newBreaches).toBe(1);

        // Only one message.create call — the one inside the $transaction.
        // Previously there was a duplicate notification message outside it.
        expect(mockPrismaMessage.create.mock.calls.length).toBe(1);

        // The $transaction should have been called with ticket update + message create
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('SLA check creates only one system message per breach (via transaction)', async () => {
        mockPrismaTicket.findMany.mockResolvedValue([sampleTicket]);

        const result = await handleSlaCheck({}, makeContext());

        expect(result.success).toBe(true);
        // Transaction should have run with ticket update + single system message
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        // Exactly one message.create call (the one building the PrismaPromise
        // inside the $transaction array) — no duplicate notification outside it
        expect(mockPrismaMessage.create).toHaveBeenCalledTimes(1);
    });

    it('does not create notification for already-breached tickets', async () => {
        const alreadyBreachedTicket = {
            ...sampleTicket,
            slaBreachedAt: new Date('2026-04-23T11:00:00Z'), // already marked
        };
        mockPrismaTicket.findMany.mockResolvedValue([alreadyBreachedTicket]);

        const result = await handleSlaCheck({}, makeContext());

        expect(result.success).toBe(true);
        // No new breaches
        expect(result.data?.newBreaches).toBe(0);
        // No notification should have been created
        expect(mockPrismaMessage.create).not.toHaveBeenCalled();
    });
});
