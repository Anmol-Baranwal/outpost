import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

vi.mock('../lib/shadow-mode.js', () => ({
    isShadowMode: vi.fn().mockReturnValue(false),
    handleShadowMessage: vi.fn().mockResolvedValue(undefined),
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

import { handleMessageCreate } from '../events/message-create.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { isShadowMode, handleShadowMessage } from '../lib/shadow-mode.js';

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-AB12CD34',
    status: 'OPEN',
    priority: 'MEDIUM',
    source: 'DISCORD',
    sourceId: 'thread-123',
    channel: 'forum-channel-1',
};

function makeMessage(overrides: Record<string, unknown> = {}) {
    return {
        author: {
            bot: false,
            tag: 'TestUser#1234',
            id: 'user-456',
            username: 'TestUser',
        },
        content: 'I still need help with this',
        url: 'https://discord.com/channels/guild/thread-123/msg-1',
        channel: {
            type: ChannelType.PublicThread,
            id: 'thread-123',
            parentId: 'forum-channel-1',
        },
        attachments: [],
        ...overrides,
    } as unknown as Parameters<typeof handleMessageCreate>[0];
}

describe('handleMessageCreate', () => {
    beforeEach(() => {
        vi.mocked(isShadowMode).mockReturnValue(false);
        // findTicketByThreadId returns the existing ticket
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        // Default: not a team member
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.user.create).mockResolvedValue({
            id: 'user-internal-id',
        } as ReturnType<typeof prisma.user.create> extends Promise<infer T> ? T : never);
    });

    it('ignores messages from bots', async () => {
        const message = makeMessage({ author: { bot: true, tag: 'Bot', id: 'bot-1', username: 'Bot' } });
        await handleMessageCreate(message);
        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('ignores messages outside of threads', async () => {
        const message = makeMessage({
            channel: { type: ChannelType.GuildText, id: 'chan-1' },
        });
        await handleMessageCreate(message);
        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('ignores messages in threads without tracked tickets', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);
        const message = makeMessage();
        await handleMessageCreate(message);
        // InboundHandler should not be invoked (no message.create call)
        expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('processes reply through InboundHandler and enqueues AI response for non-team-member', async () => {
        const message = makeMessage();
        await handleMessageCreate(message);

        // InboundHandler appends a message
        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                type: 'USER',
            }),
        });

        // InboundHandler enqueues AI response via createJob wrapper
        expect(createJob).toHaveBeenCalledWith(
            'AI_RESPONSE',
            expect.objectContaining({
                ticketId: 'ticket-1',
                source: 'discord',
            }),
        );
    });

    it('does not enqueue AI response for team member messages', async () => {
        // Set up as team member
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: 'team@copilotkit.ai',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
            id: 'tm-1',
        } as ReturnType<typeof prisma.teamMember.findUnique> extends Promise<infer T> ? T : never);

        const message = makeMessage();
        await handleMessageCreate(message);

        // Should still save the message
        expect(prisma.message.create).toHaveBeenCalled();

        // Should NOT enqueue an AI response
        expect(createJob).not.toHaveBeenCalled();
    });

    it('reopens ticket when customer replies to a resolved ticket', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
            ...TICKET,
            status: 'RESOLVED',
        } as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);

        vi.mocked(prisma.ticket.update).mockResolvedValue({
            ...TICKET,
            status: 'OPEN',
        } as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never);

        const message = makeMessage();
        await handleMessageCreate(message);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'OPEN' },
        });
    });

    // Regression: Discord dispatches BOTH ThreadCreate and MessageCreate for a
    // new forum post. handleThreadCreate already ingests the starter message,
    // so handling it again here enqueued a SECOND AI_RESPONSE job for the same
    // ticket — the same question retrieved and answered twice, ~0.2s apart.
    // A thread's starter message shares the thread's own ID.
    it('ignores the thread starter message already ingested by ThreadCreate', async () => {
        const starter = makeMessage({ id: 'thread-123' });

        await handleMessageCreate(starter);

        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
        expect(prisma.message.create).not.toHaveBeenCalled();
        expect(createJob).not.toHaveBeenCalled();
    });

    it('ignores the thread starter message in shadow mode too', async () => {
        vi.mocked(isShadowMode).mockReturnValue(true);
        const starter = makeMessage({ id: 'thread-123' });

        await handleMessageCreate(starter);

        expect(handleShadowMessage).not.toHaveBeenCalled();
        expect(createJob).not.toHaveBeenCalled();
    });

    it('still processes genuine replies in the same thread', async () => {
        const reply = makeMessage({ id: 'msg-777' });

        await handleMessageCreate(reply);

        expect(createJob).toHaveBeenCalledWith(
            'AI_RESPONSE',
            expect.objectContaining({ ticketId: 'ticket-1' }),
        );
    });

    it('uses DiscordAdapter.parseInboundEvent to normalize message events', async () => {
        const message = makeMessage();
        await handleMessageCreate(message);

        // The adapter sets isThreadStart=false for message events
        // InboundHandler should find the existing ticket (not create a new one)
        // Verify by checking ticket.create was NOT called (only findFirst and message.create)
        expect(prisma.ticket.create).not.toHaveBeenCalled();
        expect(prisma.message.create).toHaveBeenCalled();
    });
});
