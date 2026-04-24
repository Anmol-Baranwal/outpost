import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

// Mock dependencies before importing the handler
vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

vi.mock('../lib/shadow-mode.js', () => ({
    isShadowMode: vi.fn().mockReturnValue(false),
    handleShadowThreadCreate: vi.fn().mockResolvedValue('shadow-ticket-id'),
}));

vi.mock('../config.js', () => ({
    config: {
        discordToken: 'test-token',
        clientId: 'test-client-id',
        guildId: 'test-guild-id',
        monitoredChannelIds: ['forum-channel-1'],
    },
}));

// Mock discord.js REST to prevent real HTTP calls
vi.mock('discord.js', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        REST: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
            this.setToken = vi.fn().mockReturnValue(this);
            this.post = vi.fn().mockResolvedValue({});
            this.get = vi.fn().mockResolvedValue({});
        }),
    };
});

import { handleThreadCreate } from '../events/thread-create.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';

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
            author: { tag: 'TestUser#1234', id: 'user-456', username: 'TestUser' },
        }),
        send: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as Parameters<typeof handleThreadCreate>[0];
}

describe('handleThreadCreate', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.create).mockResolvedValue({
            id: 'ticket-internal-id',
            displayId: 'TKT-AB12CD34',
            status: 'OPEN',
            sourceId: 'thread-123',
            channel: 'forum-channel-1',
            source: 'DISCORD',
        } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);

        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'message-internal-id',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);

        // Default: not a team member
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
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

    it('creates a ticket via InboundHandler and enqueues AI response for a new thread', async () => {
        const thread = makeThread();
        await handleThreadCreate(thread, true);

        // InboundHandler should create a ticket via prisma
        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                source: 'DISCORD',
                sourceId: 'thread-123',
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
            }),
        });

        // InboundHandler should create the first message
        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-internal-id',
                type: 'USER',
            }),
        });

        // InboundHandler should enqueue an AI response job via our createJob wrapper
        expect(createJob).toHaveBeenCalledWith(
            'AI_RESPONSE',
            expect.objectContaining({
                ticketId: 'ticket-internal-id',
                source: 'discord',
            }),
        );
    });

    it('handles threads with no starter message content gracefully', async () => {
        const thread = makeThread();
        vi.mocked(thread.fetchStarterMessage).mockResolvedValue(null);

        await handleThreadCreate(thread, true);

        // Should still create a ticket (with empty content)
        expect(prisma.ticket.create).toHaveBeenCalled();

        // InboundHandler skips message creation when content is empty
        // (the handler checks message.content truthiness)
    });

    it('logs error and does not crash when prisma.ticket.create rejects', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(prisma.ticket.create).mockRejectedValueOnce(
            new Error('DB connection lost'),
        );

        const thread = makeThread();

        // Should not throw — the handler catches the error
        await expect(handleThreadCreate(thread, true)).resolves.toBeUndefined();

        // Should have logged the error
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Failed to create ticket'),
            expect.any(Error),
        );

        consoleSpy.mockRestore();
    });

    it('uses DiscordAdapter.parseInboundEvent to normalize the thread event', async () => {
        const thread = makeThread();
        await handleThreadCreate(thread, true);

        // Verify the InboundHandler was called (proxied through prisma.ticket.create)
        // The adapter should have extracted the correct threadId from the thread object
        const createCall = vi.mocked(prisma.ticket.create).mock.calls[0][0];
        expect(createCall.data.sourceId).toBe('thread-123');
        expect(createCall.data.channel).toBe('forum-channel-1');
    });
});
