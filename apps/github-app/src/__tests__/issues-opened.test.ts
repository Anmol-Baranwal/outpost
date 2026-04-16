import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the handler
vi.mock('@copilotkit/outpost/db', () => ({
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

vi.mock('@copilotkit/outpost/queue', () => ({
    createJob: vi.fn().mockResolvedValue('job-123'),
    JobType: {
        AI_RESPONSE: 'AI_RESPONSE',
        TICKET_CLASSIFY: 'TICKET_CLASSIFY',
    },
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    generateTicketId: vi.fn().mockReturnValue('TKT-GH01'),
    truncate: vi.fn((str: string, _len: number) => str),
}));

vi.mock('../lib/github-client.js', () => ({
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
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { postIssueComment } from '../lib/github-client.js';
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
        vi.mocked(prisma.ticket.create).mockResolvedValue({
            id: 'ticket-internal-id',
            displayId: 'TKT-GH01',
        } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);

        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'message-internal-id',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
    });

    it('creates a ticket with source=GITHUB_ISSUE and enqueues AI job', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                displayId: 'TKT-GH01',
                source: 'GITHUB_ISSUE',
                sourceId: 'CopilotKit/CopilotKit#42',
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                channel: 'CopilotKit/CopilotKit',
            }),
        });

        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-internal-id',
                type: 'USER',
            }),
        });

        expect(createJob).toHaveBeenCalledWith(
            JobType.AI_RESPONSE,
            expect.objectContaining({
                ticketId: 'ticket-internal-id',
                source: 'github',
            }),
        );
    });

    it('posts an acknowledgment comment on the issue', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(postIssueComment).toHaveBeenCalledWith(
            'CopilotKit',
            'CopilotKit',
            42,
            expect.stringContaining('TKT-GH01'),
        );
    });

    it('stores the issue URL as sourceUrl', async () => {
        const event = makeEvent();
        await handleIssueOpened(event);

        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
            }),
        });
    });

    it('handles issues with no body gracefully', async () => {
        const event = makeEvent({
            issue: {
                number: 43,
                title: 'Empty issue',
                body: null,
                html_url: 'https://github.com/CopilotKit/CopilotKit/issues/43',
            },
        });

        await handleIssueOpened(event);

        // Should still create a ticket
        expect(prisma.ticket.create).toHaveBeenCalled();

        // Should NOT create a message record (no body)
        expect(prisma.message.create).not.toHaveBeenCalled();

        // Should still enqueue AI job
        expect(createJob).toHaveBeenCalled();
    });
});
