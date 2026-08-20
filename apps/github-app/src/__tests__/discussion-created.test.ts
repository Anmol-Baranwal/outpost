import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

const mockHandleResult = {
    ticketId: 'ticket-disc-id',
    displayId: 'TKT-DS01',
    isNewTicket: true,
    isOrphanedReply: false,
    aiJobEnqueued: true,
    messageId: 'message-disc-id',
};

const mockHandle = vi.fn().mockResolvedValue(mockHandleResult);
const mockParseInboundEvent = vi.fn().mockReturnValue({
    kind: 'new_ticket',
    source: 'GITHUB_DISCUSSION',
    sourceId: 'CopilotKit/CopilotKit#7',
    sourceUrl: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
    channel: 'CopilotKit/CopilotKit',
    title: 'How to use CopilotKit with Vue?',
    body: 'I want to integrate CopilotKit into my Vue.js app.',
    author: 'curious-dev (888)',
    isBot: false,
    authorLogin: 'curious-dev',
});
const mockPostSystemMessage = vi.fn().mockResolvedValue(undefined);
const mockPostResponse = vi.fn().mockResolvedValue(undefined);

vi.mock('@copilotkit/outpost/shared', () => ({
    generateTicketId: vi.fn().mockReturnValue('TKT-DS01'),
    truncate: vi.fn((str: string, _len: number) => str),
}));

vi.mock('@copilotkit/outpost/shared/platforms', () => ({
    InboundHandler: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.handle = mockHandle;
    }),
    GitHubPlatformAdapter: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.parseInboundEvent = mockParseInboundEvent;
        this.postSystemMessage = mockPostSystemMessage;
        this.postResponse = mockPostResponse;
        this.name = 'github';
    }),
}));

vi.mock('../lib/github-client.js', () => ({
    getOctokit: vi.fn().mockReturnValue({}),
    postDiscussionComment: vi.fn().mockResolvedValue('comment-node-id'),
}));

vi.mock('../config.js', () => ({
    config: {
        appId: 'test-app-id',
        privateKey: 'test-private-key',
        installationId: 'test-installation-id',
        webhookSecret: 'test-secret',
        port: 3200,
        teamLogins: [],
        allowedRepos: ['CopilotKit/CopilotKit'],
    },
}));

import { handleDiscussionCreated } from '../webhooks/discussion-created.js';
import { prisma } from '@copilotkit/outpost/db';
import { InboundHandler, GitHubPlatformAdapter } from '@copilotkit/outpost/shared/platforms';
import type { EmitterWebhookEvent } from '@octokit/webhooks';

function makeEvent(overrides: Record<string, unknown> = {}): EmitterWebhookEvent<'discussion.created'> {
    return {
        id: 'evt-1',
        name: 'discussion',
        payload: {
            action: 'created',
            discussion: {
                number: 7,
                title: 'How to use CopilotKit with Vue?',
                body: 'I want to integrate CopilotKit into my Vue.js app.',
                html_url: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
                node_id: 'D_kwDOTest1234',
                ...(overrides.discussion as Record<string, unknown> ?? {}),
            },
            repository: {
                full_name: 'CopilotKit/CopilotKit',
                ...(overrides.repository as Record<string, unknown> ?? {}),
            },
            sender: {
                login: 'curious-dev',
                id: 888,
                type: 'User',
                ...(overrides.sender as Record<string, unknown> ?? {}),
            },
            ...overrides,
        },
    } as unknown as EmitterWebhookEvent<'discussion.created'>;
}

describe('handleDiscussionCreated', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticketExternalLink.create).mockResolvedValue({
            id: 'link-disc-1',
            ticketId: 'ticket-disc-id',
            plugin: 'github',
            externalId: 'CopilotKit/CopilotKit#7',
        } as ReturnType<typeof prisma.ticketExternalLink.create> extends Promise<infer T> ? T : never);
    });

    it('uses GitHubPlatformAdapter to parse the event', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(GitHubPlatformAdapter).toHaveBeenCalled();
        expect(mockParseInboundEvent).toHaveBeenCalledWith({
            action: 'created',
            discussion: event.payload.discussion,
            repository: event.payload.repository,
            sender: event.payload.sender,
        });
    });

    it('uses InboundHandler to create ticket and enqueue AI job', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(InboundHandler).toHaveBeenCalled();
        expect(mockHandle).toHaveBeenCalled();
    });

    it('creates TicketExternalLink for bidirectional sync', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(prisma.ticketExternalLink.create).toHaveBeenCalledWith({
            data: {
                ticketId: 'ticket-disc-id',
                plugin: 'github',
                externalId: 'CopilotKit/CopilotKit#7',
                externalUrl: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
            },
        });
    });

    it('does not post a ticket-created acknowledgment comment on the discussion', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(mockPostSystemMessage).not.toHaveBeenCalled();
    });

    it('handles discussions with no body gracefully', async () => {
        mockParseInboundEvent.mockReturnValueOnce({
            kind: 'new_ticket',
            source: 'GITHUB_DISCUSSION',
            sourceId: 'CopilotKit/CopilotKit#8',
            sourceUrl: 'https://github.com/CopilotKit/CopilotKit/discussions/8',
            channel: 'CopilotKit/CopilotKit',
            title: 'Empty discussion',
            body: '',
            author: 'curious-dev (888)',
            isBot: false,
            authorLogin: 'curious-dev',
        });

        const event = makeEvent({
            discussion: {
                number: 8,
                title: 'Empty discussion',
                body: null,
                html_url: 'https://github.com/CopilotKit/CopilotKit/discussions/8',
                node_id: 'D_kwDOTest5678',
            },
        });

        await handleDiscussionCreated(event);

        // Should still use InboundHandler (ticket creation happens there)
        expect(InboundHandler).toHaveBeenCalled();
        expect(mockHandle).toHaveBeenCalled();
    });

    it('ignores discussions on non-allowlisted repos (e.g. CopilotKit/outpost)', async () => {
        const event = makeEvent({ repository: { full_name: 'CopilotKit/outpost' } });
        await handleDiscussionCreated(event);

        expect(mockHandle).not.toHaveBeenCalled();
        expect(mockPostSystemMessage).not.toHaveBeenCalled();
    });
});
