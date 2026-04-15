import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';

// Mock dependencies before importing the handler
vi.mock('@outpost/db', () => ({
    prisma: {
        ticket: {
            create: vi.fn(),
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        message: {
            create: vi.fn(),
        },
        note: {
            create: vi.fn(),
        },
    },
}));

vi.mock('@outpost/queue', () => ({
    createJob: vi.fn().mockResolvedValue('job-123'),
    JobType: {
        PROCESS_TICKET: 'PROCESS_TICKET',
        GENERATE_RESPONSE: 'GENERATE_RESPONSE',
        SEND_NOTIFICATION: 'SEND_NOTIFICATION',
        CHECK_SLA: 'CHECK_SLA',
        ANALYZE_SENTIMENT: 'ANALYZE_SENTIMENT',
        SYNC_DOCS: 'SYNC_DOCS',
        SEND_BROADCAST: 'SEND_BROADCAST',
        INDEX_CONTENT: 'INDEX_CONTENT',
    },
}));

vi.mock('@outpost/shared', () => ({
    generateTicketId: vi.fn().mockReturnValue('TKT-AB12'),
    truncate: vi.fn((str: string, _len: number) => str),
}));

vi.mock('../config.js', () => ({
    config: {
        discordToken: 'test-token',
        clientId: 'test-client-id',
        guildId: 'test-guild-id',
        monitoredChannelIds: ['forum-channel-1'],
    },
}));

import { handleThreadCreate } from '../events/thread-create.js';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';

function makeThread(overrides: Record<string, unknown> = {}) {
    return {
        id: 'thread-123',
        name: 'Help with CopilotKit integration',
        parentId: 'forum-channel-1',
        url: 'https://discord.com/channels/guild/thread-123',
        type: ChannelType.PublicThread,
        parent: { name: 'support-forum' },
        fetchStarterMessage: vi.fn().mockResolvedValue({
            content: 'I need help integrating CopilotKit with my Next.js app.',
            author: { tag: 'TestUser#1234', id: 'user-456' },
        }),
        send: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as Parameters<typeof handleThreadCreate>[0];
}

describe('handleThreadCreate', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.create).mockResolvedValue({
            id: 'ticket-internal-id',
            displayId: 'TKT-AB12',
        } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);

        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'message-internal-id',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
    });

    it('ignores threads that are not newly created', async () => {
        const thread = makeThread();
        await handleThreadCreate(thread, false);
        expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('ignores threads in unmonitored channels', async () => {
        const thread = makeThread({ parentId: 'random-channel' });
        await handleThreadCreate(thread, true);
        expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('ignores threads without a parent channel', async () => {
        const thread = makeThread({ parentId: null });
        await handleThreadCreate(thread, true);
        expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('creates a ticket and enqueues an AI response job for a new forum thread', async () => {
        const thread = makeThread();
        await handleThreadCreate(thread, true);

        // Should create a ticket
        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                displayId: 'TKT-AB12',
                source: 'DISCORD',
                sourceId: 'thread-123',
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
            }),
        });

        // Should create the first message
        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-internal-id',
                type: 'USER',
            }),
        });

        // Should enqueue an AI response job
        expect(createJob).toHaveBeenCalledWith(
            JobType.AI_RESPONSE,
            expect.objectContaining({
                ticketId: 'ticket-internal-id',
                source: 'discord',
            }),
        );

        // Should post acknowledgment
        expect(thread.send).toHaveBeenCalledWith(
            expect.stringContaining('TKT-AB12'),
        );
    });

    it('handles threads with no starter message content gracefully', async () => {
        const thread = makeThread();
        vi.mocked(thread.fetchStarterMessage).mockResolvedValue(null);

        await handleThreadCreate(thread, true);

        // Should still create a ticket
        expect(prisma.ticket.create).toHaveBeenCalled();

        // Should NOT create a message record (no content)
        expect(prisma.message.create).not.toHaveBeenCalled();

        // Should still enqueue AI job
        expect(createJob).toHaveBeenCalled();
    });
});
