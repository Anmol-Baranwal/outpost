import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

// Mock dependencies before importing
vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

// truncate is stubbed to a pass-through so assertions can compare exact
// strings, but buildTicketSourceId/TicketSource stay REAL: the point of the
// sourceId assertions below is that shadow mode derives the key with the shared
// helper, which a stub would hide.
vi.mock('@copilotkit/outpost/shared', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@copilotkit/outpost/shared')>();
    return {
        ...actual,
        truncate: vi.fn((str: string, _len: number) => str),
    };
});

import {
    isShadowMode,
    logShadowResponse,
    handleShadowThreadCreate,
    handleShadowMessage,
} from '../lib/shadow-mode.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { TicketSource, buildTicketSourceId } from '@copilotkit/outpost/shared';

function makeThread(overrides: Record<string, unknown> = {}) {
    return {
        id: 'thread-123',
        name: 'Help with integration',
        parentId: 'forum-channel-1',
        url: 'https://discord.com/channels/guild/thread-123',
        type: ChannelType.PublicThread,
        parent: { name: 'support-forum' },
        send: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as Parameters<typeof handleShadowThreadCreate>[0];
}

function makeMessage(overrides: Record<string, unknown> = {}) {
    return {
        content: 'I have a follow-up question.',
        author: { tag: 'TestUser#1234', id: 'user-456', bot: false },
        channel: {
            id: 'thread-123',
            type: ChannelType.PublicThread,
        },
        ...overrides,
    } as unknown as Parameters<typeof handleShadowMessage>[0];
}

describe('shadow-mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.SHADOW_MODE;
    });

    describe('isShadowMode', () => {
        it('returns false when SHADOW_MODE is not set', () => {
            expect(isShadowMode()).toBe(false);
        });

        it('returns false when SHADOW_MODE is "false"', () => {
            process.env.SHADOW_MODE = 'false';
            expect(isShadowMode()).toBe(false);
        });

        it('returns true when SHADOW_MODE is "true"', () => {
            process.env.SHADOW_MODE = 'true';
            expect(isShadowMode()).toBe(true);
        });
    });

    describe('logShadowResponse', () => {
        it('creates a NOTE message with shadow metadata', async () => {
            vi.mocked(prisma.message.create).mockResolvedValue({
                id: 'msg-1',
            } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);

            await logShadowResponse({
                ticketId: 'ticket-1',
                threadId: 'thread-123',
                generatedContent: 'Here is how to fix it...',
                generatedAt: new Date('2024-01-15T12:00:00Z'),
                responseTimeMs: 5000,
            });

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    author: 'outpost-shadow',
                    content: 'Here is how to fix it...',
                    type: 'SYSTEM',
                    isAiGenerated: true,
                    attachments: expect.objectContaining({
                        threadId: 'thread-123',
                        responseTimeMs: 5000,
                        generatedAt: '2024-01-15T12:00:00.000Z',
                    }),
                }),
            });
        });
    });

    describe('handleShadowThreadCreate', () => {
        beforeEach(() => {
            vi.mocked(prisma.ticket.create).mockResolvedValue({
                id: 'ticket-internal-id',
                displayId: 'TKT-0001',
            } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);

            vi.mocked(prisma.message.create).mockResolvedValue({
                id: 'msg-1',
            } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        });

        it('creates a ticket in the database', async () => {
            const thread = makeThread();
            const result = await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'My question content',
                'TestUser#1234',
                'user-456',
            );

            expect(result).toBe('ticket-internal-id');
            expect(prisma.ticket.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    displayId: 'TKT-0001',
                    source: 'DISCORD',
                    sourceId: 'thread-123',
                    status: 'OPEN',
                }),
            });
        });

        // The writer must derive sourceId with buildTicketSourceId, not inline
        // thread.id: findTicketByThreadId reads through that helper, so an
        // inlined write silently desynchronizes the moment the derivation
        // changes (exactly the null-vs-'' bug this helper was introduced for).
        it('derives sourceId with buildTicketSourceId, not an inlined thread.id', async () => {
            const thread = makeThread({ id: 'thread-999' });
            await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'My question',
                'TestUser#1234',
                'user-456',
            );

            const { data } = vi.mocked(prisma.ticket.create).mock.calls[0]![0] as {
                data: { sourceId: string | null };
            };
            expect(data.sourceId).toBe(
                buildTicketSourceId(TicketSource.DISCORD, 'thread-999'),
            );
            expect(data.sourceId).toBe('thread-999');
        });

        it('stores a null sourceId for an unaddressable thread', async () => {
            // No thread key means no reply can ever find this ticket. We still
            // create it (never drop the report) but must store the helper's null
            // rather than an empty-string placeholder a reader would search for.
            const thread = makeThread({ id: '' });
            const result = await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'My question',
                'TestUser#1234',
                'user-456',
            );

            expect(result).toBe('ticket-internal-id');
            const { data } = vi.mocked(prisma.ticket.create).mock.calls[0]![0] as {
                data: { sourceId: string | null };
            };
            expect(data.sourceId).toBeNull();
        });

        it('creates a message record for the content', async () => {
            const thread = makeThread();
            await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'My question content',
                'TestUser#1234',
                'user-456',
            );

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-internal-id',
                    type: 'USER',
                }),
            });
        });

        it('does NOT post to Discord (no thread.send call)', async () => {
            const thread = makeThread();
            await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'My question',
                'TestUser#1234',
                'user-456',
            );

            expect(thread.send).not.toHaveBeenCalled();
        });

        it('enqueues an AI response job for the created ticket', async () => {
            const thread = makeThread();
            await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'My question',
                'TestUser#1234',
                'user-456',
            );

            expect(createJob).toHaveBeenCalledWith(
                JobType.AI_RESPONSE,
                expect.objectContaining({
                    ticketId: 'ticket-internal-id',
                    threadId: 'thread-123',
                    source: 'discord',
                }),
            );
        });

        it('skips message creation when content is empty', async () => {
            const thread = makeThread();
            await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                '',
                'TestUser#1234',
                'user-456',
            );

            expect(prisma.ticket.create).toHaveBeenCalled();
            expect(prisma.message.create).not.toHaveBeenCalled();
        });

        it('returns null on failure', async () => {
            vi.mocked(prisma.ticket.create).mockRejectedValue(new Error('DB error'));

            const thread = makeThread();
            const result = await handleShadowThreadCreate(
                thread,
                'TKT-0001',
                'content',
                'TestUser#1234',
                'user-456',
            );

            expect(result).toBeNull();
        });
    });

    describe('handleShadowMessage', () => {
        beforeEach(() => {
            vi.mocked(prisma.message.create).mockResolvedValue({
                id: 'msg-1',
            } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        });

        it('records the message in the database', async () => {
            const message = makeMessage();
            await handleShadowMessage(message, 'ticket-1', 'thread-123');

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    type: 'USER',
                }),
            });
        });

        // Shadow mode has to mirror production, and production answers a ticket
        // once — on its opening message. Enqueuing on replies here would make
        // shadow traffic look chattier than the real bot.
        it('does not enqueue an AI response job for a reply', async () => {
            const message = makeMessage();
            await handleShadowMessage(message, 'ticket-1', 'thread-123');

            expect(createJob).not.toHaveBeenCalled();
        });
    });
});
