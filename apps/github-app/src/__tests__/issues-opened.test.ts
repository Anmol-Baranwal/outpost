import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

// Mock dependencies before importing the handler
vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

const mockHandleResult = {
    ticketId: 'ticket-internal-id',
    displayId: 'TKT-GH01',
    isNewTicket: true,
    aiJobEnqueued: true,
    messageId: 'message-internal-id',
};

const mockHandle = vi.fn().mockResolvedValue(mockHandleResult);
const mockParseInboundEvent = vi.fn().mockReturnValue({
    kind: 'new_ticket',
    source: 'GITHUB_ISSUE',
    sourceId: 'CopilotKit/CopilotKit#42',
    sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
    channel: 'CopilotKit/CopilotKit',
    title: 'Bug: CopilotKit crashes on init',
    body: 'When I call useCopilotKit() in my Next.js app, it crashes.',
    author: 'user123 (999)',
    isBot: false,
    authorLogin: 'user123',
});
const mockPostSystemMessage = vi.fn().mockResolvedValue(undefined);
const mockPostResponse = vi.fn().mockResolvedValue(undefined);

vi.mock('@copilotkit/outpost/shared', () => ({
    generateTicketId: vi.fn().mockReturnValue('TKT-GH01'),
    truncate: vi.fn((str: string, _len: number) => str),
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
    postIssueComment: vi.fn().mockResolvedValue(12345),
}));

vi.mock('../config.js', () => ({
    config: {
        appId: 'test-app-id',
        privateKey: 'test-private-key',
        installationId: 'test-installation-id',
        webhookSecret: 'test-secret',
        port: 3200,
        teamLogins: ['teambot'],
    },
}));

import { handleIssueOpened } from '../webhooks/issues-opened.js';
import { prisma } from '@copilotkit/outpost/db';
import { InboundHandler, GitHubPlatformAdapter } from '@copilotkit/outpost/shared';
import type { EmitterWebhookEvent } from '@octokit/webhooks';

function makeEvent(overrides: Record<string, unknown> = {}): EmitterWebhookEvent<'issues.opened'> {
    return {
        id: 'evt-1',
        name: 'issues',
        payload: {
            action: 'opened',
            issue: {
                number: 42,
                title: 'Bug: CopilotKit crashes on init',
                body: 'When I call useCopilotKit() in my Next.js app, it crashes.',
                html_url: 'https://github.com/CopilotKit/CopilotKit/issues/42',
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
    } as unknown as EmitterWebhookEvent<'issues.opened'>;
}

describe('handleIssueOpened', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticketExternalLink.create).mockResolvedValue({
            id: 'link-1',
            ticketId: 'ticket-internal-id',
            plugin: 'github',
            externalId: 'CopilotKit/CopilotKit#42',
        } as ReturnType<typeof prisma.ticketExternalLink.create> extends Promise<infer T> ? T : never);
    });

    it('uses GitHubPlatformAdapter to parse the event', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(GitHubPlatformAdapter).toHaveBeenCalled();
        expect(mockParseInboundEvent).toHaveBeenCalledWith({
            action: 'opened',
            issue: event.payload.issue,
            repository: event.payload.repository,
            sender: event.payload.sender,
        });
    });

    it('uses InboundHandler to create ticket and enqueue AI job', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(InboundHandler).toHaveBeenCalled();
        expect(mockHandle).toHaveBeenCalled();
    });

    it('creates TicketExternalLink for bidirectional sync', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(prisma.ticketExternalLink.create).toHaveBeenCalledWith({
            data: {
                ticketId: 'ticket-internal-id',
                plugin: 'github',
                externalId: 'CopilotKit/CopilotKit#42',
                externalUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
            },
        });
    });

    it('posts an acknowledgment via adapter.postSystemMessage', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(mockPostSystemMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'ticket-internal-id',
                source: 'GITHUB_ISSUE',
            }),
            expect.stringContaining('TKT-GH01'),
        );
    });

    it('handles parse failure gracefully', async () => {
        mockParseInboundEvent.mockReturnValueOnce(null);

        const event = makeEvent();
        await handleIssueOpened(event);

        // Should not create external link or call InboundHandler
        expect(prisma.ticketExternalLink.create).not.toHaveBeenCalled();
        expect(mockHandle).not.toHaveBeenCalled();
    });
});
