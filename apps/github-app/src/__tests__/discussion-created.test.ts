import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@copilotkit/outpost-db', () => ({
    prisma: {
        ticket: {
            create: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn(),
        },
        message: {
            create: vi.fn(),
        },
    },
}));

vi.mock('@copilotkit/outpost-queue', () => ({
    createJob: vi.fn().mockResolvedValue('job-123'),
    JobType: {
        AI_RESPONSE: 'AI_RESPONSE',
    },
}));

vi.mock('@copilotkit/outpost-shared', () => ({
    generateTicketId: vi.fn().mockReturnValue('TKT-DS01'),
    truncate: vi.fn((str: string, _len: number) => str),
}));

vi.mock('../lib/github-client.js', () => ({
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
    },
}));

import { handleDiscussionCreated } from '../webhooks/discussion-created.js';
import { prisma } from '@copilotkit/outpost-db';
import { createJob, JobType } from '@copilotkit/outpost-queue';
import { postDiscussionComment } from '../lib/github-client.js';
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
        vi.mocked(prisma.ticket.create).mockResolvedValue({
            id: 'ticket-disc-id',
            displayId: 'TKT-DS01',
        } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);

        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'message-disc-id',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
    });

    it('creates a ticket with source=GITHUB_DISCUSSION and enqueues AI job', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                displayId: 'TKT-DS01',
                source: 'GITHUB_DISCUSSION',
                sourceId: 'CopilotKit/CopilotKit#7',
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                channel: 'CopilotKit/CopilotKit',
            }),
        });

        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-disc-id',
                type: 'USER',
            }),
        });

        expect(createJob).toHaveBeenCalledWith(
            JobType.AI_RESPONSE,
            expect.objectContaining({
                ticketId: 'ticket-disc-id',
                source: 'github',
            }),
        );
    });

    it('posts an acknowledgment comment via GraphQL', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(postDiscussionComment).toHaveBeenCalledWith(
            'D_kwDOTest1234',
            expect.stringContaining('TKT-DS01'),
        );
    });

    it('stores the discussion URL as sourceUrl', async () => {
        const event = makeEvent();
        await handleDiscussionCreated(event);

        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                sourceUrl: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
            }),
        });
    });

    it('handles discussions with no body gracefully', async () => {
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

        expect(prisma.ticket.create).toHaveBeenCalled();
        expect(prisma.message.create).not.toHaveBeenCalled();
        expect(createJob).toHaveBeenCalled();
    });
});
