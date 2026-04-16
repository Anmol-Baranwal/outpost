/**
 * Tests for Linear webhook → Outpost sync handler.
 *
 * Verifies that Linear webhooks correctly create/update Outpost tickets
 * and messages via the sync handler functions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    handleIssueCreated,
    handleIssueUpdated,
    handleCommentCreated,
    mapLinearStatus,
    mapLinearPriority,
    type SyncHandlerDeps,
} from '../webhooks/sync-handler.js';
import type { ParsedIssueCreated } from '../webhooks/issue-created.js';
import type { ParsedIssueUpdated } from '../webhooks/issue-updated.js';
import type { ParsedCommentCreated } from '../webhooks/comment-created.js';

// ─── Mock Factory ─────────────────────────────────────────────────────────

function makeMockDeps(): SyncHandlerDeps {
    return {
        prisma: {
            ticket: {
                create: vi.fn().mockResolvedValue({ id: 'tkt-new-1' }),
                findFirst: vi.fn().mockResolvedValue(null),
                update: vi.fn().mockResolvedValue({ id: 'tkt-1' }),
            },
            ticketExternalLink: {
                create: vi.fn().mockResolvedValue({ id: 'link-new-1' }),
                findUnique: vi.fn().mockResolvedValue(null),
            },
            message: {
                create: vi.fn().mockResolvedValue({ id: 'msg-new-1' }),
            },
        },
    };
}

// ─── Status Mapping Tests ─────────────────────────────────────────────────

describe('mapLinearStatus', () => {
    it('maps Triage to OPEN', () => {
        expect(mapLinearStatus('Triage')).toBe('OPEN');
    });

    it('maps In Progress to IN_PROGRESS', () => {
        expect(mapLinearStatus('In Progress')).toBe('IN_PROGRESS');
    });

    it('maps Done to RESOLVED', () => {
        expect(mapLinearStatus('Done')).toBe('RESOLVED');
    });

    it('maps Canceled to CLOSED', () => {
        expect(mapLinearStatus('Canceled')).toBe('CLOSED');
    });

    it('maps null to OPEN', () => {
        expect(mapLinearStatus(null)).toBe('OPEN');
    });

    it('maps unknown status to OPEN', () => {
        expect(mapLinearStatus('SomeCustomStatus')).toBe('OPEN');
    });
});

describe('mapLinearPriority', () => {
    it('maps 1 (Urgent) to CRITICAL', () => {
        expect(mapLinearPriority(1)).toBe('CRITICAL');
    });

    it('maps 2 (High) to HIGH', () => {
        expect(mapLinearPriority(2)).toBe('HIGH');
    });

    it('maps 3 (Medium) to MEDIUM', () => {
        expect(mapLinearPriority(3)).toBe('MEDIUM');
    });

    it('maps 4 (Low) to LOW', () => {
        expect(mapLinearPriority(4)).toBe('LOW');
    });

    it('maps 0 (None) to MEDIUM', () => {
        expect(mapLinearPriority(0)).toBe('MEDIUM');
    });
});

// ─── handleIssueCreated Tests ─────────────────────────────────────────────

describe('handleIssueCreated', () => {
    let deps: SyncHandlerDeps;

    beforeEach(() => {
        deps = makeMockDeps();
    });

    it('creates an Outpost ticket with correct fields', async () => {
        const parsed: ParsedIssueCreated = {
            action: 'create',
            issueId: 'lin-issue-123',
            title: 'Fix login bug',
            description: 'Users cannot log in',
            status: 'In Progress',
            priority: 2,
            priorityLabel: 'High',
            assigneeId: 'user-1',
            labels: [{ id: 'l1', name: 'bug' }],
            teamId: 'team-1',
            createdAt: '2026-04-15T10:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
        };

        const result = await handleIssueCreated(deps, parsed);

        expect(result.ticketId).toBe('tkt-new-1');
        expect(result.linkId).toBe('link-new-1');

        expect(deps.prisma.ticket.create).toHaveBeenCalledWith({
            data: {
                displayId: expect.stringMatching(/^TKT-/),
                title: 'Fix login bug',
                description: 'Users cannot log in',
                status: 'IN_PROGRESS',
                priority: 'HIGH',
                source: 'LINEAR',
                internalTracker: 'linear',
                internalId: 'lin-issue-123',
                externalUrl: 'https://linear.app/team/issue/ABC-123',
            },
        });

        expect(deps.prisma.ticketExternalLink.create).toHaveBeenCalledWith({
            data: {
                ticketId: 'tkt-new-1',
                plugin: 'linear',
                externalId: 'lin-issue-123',
                externalUrl: 'https://linear.app/team/issue/ABC-123',
            },
        });
    });

    it('handles null description', async () => {
        const parsed: ParsedIssueCreated = {
            action: 'create',
            issueId: 'lin-issue-456',
            title: 'No description issue',
            description: null,
            status: null,
            priority: 0,
            priorityLabel: 'None',
            assigneeId: null,
            labels: [],
            teamId: 'team-1',
            createdAt: '2026-04-15T10:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-456',
        };

        await handleIssueCreated(deps, parsed);

        expect(deps.prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                description: '',
                status: 'OPEN',
                priority: 'MEDIUM',
            }),
        });
    });
});

// ─── handleIssueUpdated Tests ─────────────────────────────────────────────

describe('handleIssueUpdated', () => {
    let deps: SyncHandlerDeps;

    beforeEach(() => {
        deps = makeMockDeps();
    });

    it('updates Outpost ticket status when Linear issue status changes', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'tkt-1',
            plugin: 'linear',
            externalId: 'lin-issue-123',
        });

        const parsed: ParsedIssueUpdated = {
            action: 'update',
            issueId: 'lin-issue-123',
            updatedFields: ['state'],
            status: 'Done',
            teamId: 'team-1',
            updatedAt: '2026-04-15T11:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
        };

        const result = await handleIssueUpdated(deps, parsed);

        expect(result.ticketId).toBe('tkt-1');
        expect(result.updated).toBe(true);

        expect(deps.prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'tkt-1' },
            data: expect.objectContaining({
                status: 'RESOLVED',
            }),
        });
    });

    it('updates priority when Linear priority changes', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'tkt-1',
            plugin: 'linear',
            externalId: 'lin-issue-123',
        });

        const parsed: ParsedIssueUpdated = {
            action: 'update',
            issueId: 'lin-issue-123',
            updatedFields: ['priority'],
            priority: 1,
            priorityLabel: 'Urgent',
            teamId: 'team-1',
            updatedAt: '2026-04-15T11:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
        };

        const result = await handleIssueUpdated(deps, parsed);

        expect(result.updated).toBe(true);
        expect(deps.prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'tkt-1' },
            data: expect.objectContaining({
                priority: 'CRITICAL',
            }),
        });
    });

    it('returns updated=false when no linked ticket exists', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue(null);

        const parsed: ParsedIssueUpdated = {
            action: 'update',
            issueId: 'orphan-issue',
            updatedFields: ['state'],
            status: 'Done',
            teamId: 'team-1',
            updatedAt: '2026-04-15T11:00:00.000Z',
            url: 'https://linear.app/team/issue/ORPHAN-1',
        };

        const result = await handleIssueUpdated(deps, parsed);

        expect(result.ticketId).toBe('');
        expect(result.updated).toBe(false);
        expect(deps.prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('updates title when Linear title changes', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'tkt-1',
            plugin: 'linear',
            externalId: 'lin-issue-123',
        });

        const parsed: ParsedIssueUpdated = {
            action: 'update',
            issueId: 'lin-issue-123',
            updatedFields: ['title'],
            title: 'Updated title',
            teamId: 'team-1',
            updatedAt: '2026-04-15T11:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
        };

        const result = await handleIssueUpdated(deps, parsed);

        expect(result.updated).toBe(true);
        expect(deps.prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'tkt-1' },
            data: expect.objectContaining({
                title: 'Updated title',
            }),
        });
    });
});

// ─── handleCommentCreated Tests ───────────────────────────────────────────

describe('handleCommentCreated', () => {
    let deps: SyncHandlerDeps;

    beforeEach(() => {
        deps = makeMockDeps();
    });

    it('creates a Message record for the linked ticket', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'tkt-1',
            plugin: 'linear',
            externalId: 'lin-issue-123',
        });

        const parsed: ParsedCommentCreated = {
            action: 'create',
            commentId: 'comment-abc',
            body: 'This is a comment from Linear',
            issueId: 'lin-issue-123',
            userId: 'user-xyz',
            userName: 'Alice',
            createdAt: '2026-04-15T12:00:00.000Z',
        };

        const result = await handleCommentCreated(deps, parsed);

        expect(result.ticketId).toBe('tkt-1');
        expect(result.messageId).toBe('msg-new-1');
        expect(result.created).toBe(true);

        expect(deps.prisma.message.create).toHaveBeenCalledWith({
            data: {
                ticketId: 'tkt-1',
                content: 'This is a comment from Linear',
                type: 'USER',
                author: 'Alice',
            },
        });
    });

    it('returns created=false when no linked ticket exists', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue(null);

        const parsed: ParsedCommentCreated = {
            action: 'create',
            commentId: 'comment-orphan',
            body: 'Orphan comment',
            issueId: 'orphan-issue',
            userId: null,
            userName: null,
            createdAt: '2026-04-15T12:00:00.000Z',
        };

        const result = await handleCommentCreated(deps, parsed);

        expect(result.created).toBe(false);
        expect(deps.prisma.message.create).not.toHaveBeenCalled();
    });

    it('uses default author name when userName is null', async () => {
        vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'tkt-1',
            plugin: 'linear',
            externalId: 'lin-issue-123',
        });

        const parsed: ParsedCommentCreated = {
            action: 'create',
            commentId: 'comment-no-name',
            body: 'Anonymous comment',
            issueId: 'lin-issue-123',
            userId: 'user-123',
            userName: null,
            createdAt: '2026-04-15T12:00:00.000Z',
        };

        await handleCommentCreated(deps, parsed);

        expect(deps.prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                author: 'Linear User',
            }),
        });
    });
});
