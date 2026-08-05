import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

const mockParseInboundEvent = vi.fn().mockReturnValue({
    kind: 'follow_up',
    source: 'GITHUB_ISSUE',
    sourceId: 'CopilotKit/CopilotKit#42',
    sourceUrl: '',
    channel: 'CopilotKit/CopilotKit',
    body: 'I still have this problem after upgrading',
    author: 'user123 (999)',
    isBot: false,
    authorLogin: 'user123',
});
const mockPostSystemMessage = vi.fn().mockResolvedValue(undefined);
const mockPostResponse = vi.fn().mockResolvedValue(undefined);

vi.mock('@copilotkit/outpost/shared', () => ({
    truncate: vi.fn((str: string, _len: number) => str),
}));

vi.mock('@copilotkit/outpost/shared/platforms', () => ({
    GitHubPlatformAdapter: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.parseInboundEvent = mockParseInboundEvent;
        this.postSystemMessage = mockPostSystemMessage;
        this.postResponse = mockPostResponse;
        this.name = 'github';
    }),
    InboundHandler: vi.fn(),
}));

vi.mock('../lib/github-client.js', () => ({
    getOctokit: vi.fn().mockReturnValue({}),
}));

vi.mock('../config.js', () => ({
    config: {
        appId: 'test-app-id',
        privateKey: 'test-private-key',
        installationId: 'test-installation-id',
        webhookSecret: 'test-secret',
        port: 3200,
        teamLogins: ['teambot', 'admin-user'],
        allowedRepos: ['CopilotKit/CopilotKit'],
    },
}));

import { handleIssueComment } from '../webhooks/issue-comment.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { GitHubPlatformAdapter } from '@copilotkit/outpost/shared/platforms';
import type { EmitterWebhookEvent } from '@octokit/webhooks';

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-GH01',
    status: 'OPEN',
    priority: 'MEDIUM',
    source: 'GITHUB_ISSUE',
    sourceId: '42',
};

function makeEvent(overrides: Record<string, unknown> = {}): EmitterWebhookEvent<'issue_comment.created'> {
    return {
        id: 'evt-1',
        name: 'issue_comment',
        payload: {
            action: 'created',
            comment: {
                body: 'I still have this problem after upgrading',
                id: 100,
                ...(overrides.comment as Record<string, unknown> ?? {}),
            },
            issue: {
                number: 42,
                ...(overrides.issue as Record<string, unknown> ?? {}),
            },
            repository: {
                full_name: 'CopilotKit/CopilotKit',
                ...(overrides.repository as Record<string, unknown> ?? {}),
            },
            sender: {
                login: 'user123',
                id: 999,
                type: 'User',
                ...(overrides.sender as Record<string, unknown> ?? {}),
            },
            ...overrides,
        },
    } as unknown as EmitterWebhookEvent<'issue_comment.created'>;
}

describe('handleIssueComment', () => {
    beforeEach(() => {
        // Primary lookup via TicketExternalLink
        vi.mocked(prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'ticket-1',
            plugin: 'github',
            externalId: 'CopilotKit/CopilotKit#42',
            ticket: TICKET,
        } as unknown as ReturnType<typeof prisma.ticketExternalLink.findUnique> extends Promise<infer T> ? T : never);

        // Legacy fallback (should not be reached when link exists)
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never,
        );
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        // Default: not a team member (no DB match either)
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    });

    it('skips comments from bots', async () => {
        const event = makeEvent({
            sender: { login: 'bot[bot]', id: 1, type: 'Bot' },
        });
        await handleIssueComment(event);

        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('ignores comments on issues without tracked tickets', async () => {
        vi.mocked(prisma.ticketExternalLink.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);
        const event = makeEvent();
        await handleIssueComment(event);

        expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('uses GitHubPlatformAdapter to parse the comment event', async () => {
        const event = makeEvent();
        await handleIssueComment(event);

        expect(GitHubPlatformAdapter).toHaveBeenCalled();
        expect(mockParseInboundEvent).toHaveBeenCalledWith({
            action: 'created',
            comment: event.payload.comment,
            issue: event.payload.issue,
            repository: event.payload.repository,
            sender: event.payload.sender,
        });
    });

    it('appends a message and enqueues AI response for non-team-member', async () => {
        const event = makeEvent();
        await handleIssueComment(event);

        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                type: 'USER',
                content: 'I still have this problem after upgrading',
            }),
        });

        expect(createJob).toHaveBeenCalledWith(
            'AI_RESPONSE',
            expect.objectContaining({
                ticketId: 'ticket-1',
                source: 'github',
            }),
        );
    });

    it('does not enqueue AI response for team member comments (static list)', async () => {
        const event = makeEvent({
            sender: { login: 'admin-user', id: 555, type: 'User' },
        });
        await handleIssueComment(event);

        // Should still save the message
        expect(prisma.message.create).toHaveBeenCalled();

        // Should NOT enqueue an AI response
        expect(createJob).not.toHaveBeenCalled();
    });

    it('does not enqueue AI response for team member comments (DB lookup)', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: 'team@copilotkit.ai',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
            id: 'tm-1',
        } as ReturnType<typeof prisma.teamMember.findUnique> extends Promise<infer T> ? T : never);

        const event = makeEvent();
        await handleIssueComment(event);

        expect(prisma.message.create).toHaveBeenCalled();
        expect(createJob).not.toHaveBeenCalled();
    });

    it('reopens ticket when customer replies to a resolved ticket', async () => {
        const resolvedTicket = { ...TICKET, status: 'RESOLVED' };
        vi.mocked(prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'ticket-1',
            plugin: 'github',
            externalId: 'CopilotKit/CopilotKit#42',
            ticket: resolvedTicket,
        } as unknown as ReturnType<typeof prisma.ticketExternalLink.findUnique> extends Promise<infer T> ? T : never);

        const event = makeEvent();
        await handleIssueComment(event);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'OPEN' },
        });
    });

    it('updates status when team member replies to WAITING_ON_TEAM ticket', async () => {
        const waitingTicket = { ...TICKET, status: 'WAITING_ON_TEAM' };
        vi.mocked(prisma.ticketExternalLink.findUnique).mockResolvedValue({
            id: 'link-1',
            ticketId: 'ticket-1',
            plugin: 'github',
            externalId: 'CopilotKit/CopilotKit#42',
            ticket: waitingTicket,
        } as unknown as ReturnType<typeof prisma.ticketExternalLink.findUnique> extends Promise<infer T> ? T : never);

        const event = makeEvent({
            sender: { login: 'teambot', id: 777, type: 'User' },
        });
        await handleIssueComment(event);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'WAITING_ON_CUSTOMER' },
        });
    });

    it('ignores comments on non-allowlisted repos (e.g. CopilotKit/outpost)', async () => {
        const event = makeEvent({ repository: { full_name: 'CopilotKit/outpost' } });
        await handleIssueComment(event);

        expect(prisma.message.create).not.toHaveBeenCalled();
        expect(createJob).not.toHaveBeenCalled();
    });
});
