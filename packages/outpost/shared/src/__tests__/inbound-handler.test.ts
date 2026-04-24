/**
 * InboundHandler tests — covers GitHub-specific event parsing flows.
 *
 * The canonical InboundHandler tests live in platforms-inbound.test.ts.
 * This file focuses on GitHub-specific edge cases like the {type, payload}
 * event shape used by the GitHub App webhook handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboundHandler } from '../platforms/inbound.js';
import type { PrismaLike, CreateJobFn } from '../platforms/inbound.js';
import type { InboundMessage } from '../platforms/types.js';
import { TicketSource } from '../types.js';

// ── Mock Prisma ───────────────────────────────────────────────────────────

function makeMockPrisma(): PrismaLike {
    return {
        ticket: {
            create: vi.fn().mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TEST01',
                status: 'OPEN',
                sourceId: 'CopilotKit/CopilotKit#42',
                channel: 'CopilotKit/CopilotKit',
                source: 'GITHUB_ISSUE',
            }),
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TEST01',
                status: 'OPEN',
            }),
        },
        message: {
            create: vi.fn().mockResolvedValue({
                id: 'msg-1',
            }),
        },
        user: {
            findFirst: vi.fn().mockResolvedValue(null),
        },
        teamMember: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        ticketExternalLink: {
            create: vi.fn().mockResolvedValue({ id: 'link-1' }),
        },
    };
}

function makeNewTicketMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
        platformUserId: 'user123',
        platformUsername: 'user123',
        content: 'When I call useCopilotKit(), it crashes.',
        threadId: 'CopilotKit/CopilotKit#42',
        channelId: 'CopilotKit/CopilotKit',
        sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
        source: TicketSource.GITHUB_ISSUE,
        isThreadStart: true,
        rawEvent: {},
        ...overrides,
    };
}

function makeFollowUpMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
        platformUserId: 'user123',
        platformUsername: 'user123',
        content: 'I still have this problem after upgrading',
        threadId: 'CopilotKit/CopilotKit#42',
        channelId: 'CopilotKit/CopilotKit',
        sourceUrl: '',
        source: TicketSource.GITHUB_ISSUE,
        isThreadStart: false,
        rawEvent: {},
        ...overrides,
    };
}

describe('InboundHandler (GitHub-focused)', () => {
    let prisma: ReturnType<typeof makeMockPrisma>;
    let createJob: ReturnType<typeof vi.fn>;
    let handler: InboundHandler;

    beforeEach(() => {
        prisma = makeMockPrisma();
        createJob = vi.fn().mockResolvedValue('job-1');
        handler = new InboundHandler({
            prisma,
            createJob: createJob as CreateJobFn,
        });
    });

    // ── New Tickets ──────────────────────────────────────────────────

    describe('new_ticket (isThreadStart=true)', () => {
        it('creates a ticket with correct fields', async () => {
            const message = makeNewTicketMessage();
            await handler.handle(message);

            expect(prisma.ticket.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    status: 'OPEN',
                    priority: 'MEDIUM',
                    type: 'QUESTION',
                    source: 'GITHUB_ISSUE',
                    sourceId: 'CopilotKit/CopilotKit#42',
                    sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
                    channel: 'CopilotKit/CopilotKit',
                }),
            });
        });

        it('generates a unique displayId', async () => {
            const message = makeNewTicketMessage();
            await handler.handle(message);

            const createArgs = vi.mocked(prisma.ticket.create).mock.calls[0][0];
            expect(createArgs.data.displayId).toMatch(/^TKT-[A-Z0-9]+$/);
        });

        it('creates a message record from the content', async () => {
            const message = makeNewTicketMessage();
            await handler.handle(message);

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    author: expect.stringContaining('user123'),
                    type: 'USER',
                }),
            });
        });

        it('skips message creation when content is empty', async () => {
            const message = makeNewTicketMessage({ content: '' });
            await handler.handle(message);

            expect(prisma.message.create).not.toHaveBeenCalled();
        });

        it('enqueues an AI_RESPONSE job', async () => {
            const message = makeNewTicketMessage();
            await handler.handle(message);

            expect(createJob).toHaveBeenCalledWith('AI_RESPONSE', {
                ticketId: 'ticket-1',
                threadId: 'CopilotKit/CopilotKit#42',
                source: 'github',
            });
        });

        it('returns isNewTicket=true and aiJobEnqueued=true', async () => {
            const message = makeNewTicketMessage();
            const result = await handler.handle(message);

            expect(result.isNewTicket).toBe(true);
            expect(result.aiJobEnqueued).toBe(true);
            expect(result.ticketId).toBe('ticket-1');
        });

        it('maps GITHUB_DISCUSSION source to "github" job source', async () => {
            const message = makeNewTicketMessage({
                source: TicketSource.GITHUB_DISCUSSION,
            });
            await handler.handle(message);

            expect(createJob).toHaveBeenCalledWith('AI_RESPONSE', {
                ticketId: 'ticket-1',
                threadId: 'CopilotKit/CopilotKit#42',
                source: 'github',
            });
        });
    });

    // ── Follow-ups ───────────────────────────────────────────────────

    describe('follow_up (isThreadStart=false)', () => {
        const existingTicket = {
            id: 'ticket-existing',
            displayId: 'TKT-GH01',
            status: 'OPEN',
            sourceId: 'CopilotKit/CopilotKit#42',
            channel: 'CopilotKit/CopilotKit',
            source: 'GITHUB_ISSUE',
        };

        beforeEach(() => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue(existingTicket);
        });

        it('appends message to existing ticket', async () => {
            const message = makeFollowUpMessage();
            const result = await handler.handle(message);

            expect(result.isNewTicket).toBe(false);
            expect(result.ticketId).toBe('ticket-existing');

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-existing',
                    author: expect.stringContaining('user123'),
                    type: 'USER',
                }),
            });
        });

        it('enqueues AI_RESPONSE for non-team-member follow-ups', async () => {
            const message = makeFollowUpMessage();
            await handler.handle(message);

            expect(createJob).toHaveBeenCalledWith('AI_RESPONSE', expect.objectContaining({
                ticketId: 'ticket-existing',
                source: 'github',
            }));
        });

        it('creates new ticket if no existing ticket found for reply thread', async () => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

            const message = makeFollowUpMessage();
            const result = await handler.handle(message);

            // Falls back to creating a new ticket
            expect(result.isNewTicket).toBe(true);
            expect(prisma.ticket.create).toHaveBeenCalledTimes(1);
        });

        it('returns isNewTicket=false for follow-ups', async () => {
            const message = makeFollowUpMessage();
            const result = await handler.handle(message);

            expect(result.isNewTicket).toBe(false);
        });
    });
});
