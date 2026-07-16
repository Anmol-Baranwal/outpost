import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboundHandler } from '../platforms/inbound.js';
import type { PrismaLike, CreateJobFn } from '../platforms/inbound.js';
import type { InboundMessage } from '../platforms/types.js';
import { TicketSource } from '../types.js';

// ── Mock Prisma ────────────────────────────────────────────────────────

function createMockPrisma(): PrismaLike {
    return {
        ticket: {
            create: vi.fn().mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-ABCDEF12',
                status: 'OPEN',
                sourceId: 'thread-123',
                channel: 'channel-1',
                source: 'DISCORD',
            }),
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-ABCDEF12',
                status: 'OPEN',
            }),
        },
        message: {
            create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
        },
        user: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'user-new-1' }),
        },
        teamMember: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        ticketExternalLink: {
            create: vi.fn().mockResolvedValue({ id: 'link-1' }),
        },
    };
}

function createMockCreateJob(): CreateJobFn {
    return vi.fn().mockResolvedValue('job-1');
}

function makeInboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
        platformUserId: 'user-123',
        platformUsername: 'testuser',
        content: 'Hello, I need help with the SDK',
        threadId: 'thread-123',
        channelId: 'channel-1',
        sourceUrl: 'https://discord.com/channels/123/456/789',
        source: TicketSource.DISCORD,
        isThreadStart: true,
        rawEvent: { type: 'message' },
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('InboundHandler', () => {
    let prisma: PrismaLike;
    let createJob: CreateJobFn;
    let handler: InboundHandler;

    beforeEach(() => {
        prisma = createMockPrisma();
        createJob = createMockCreateJob();
        handler = new InboundHandler({ prisma, createJob });
    });

    // ── New ticket creation ──────────────────────────────────────────

    describe('new ticket creation (isThreadStart=true)', () => {
        it('creates a ticket and first message in the database', async () => {
            const msg = makeInboundMessage();
            const result = await handler.handle(msg);

            expect(result.isNewTicket).toBe(true);
            expect(result.ticketId).toBe('ticket-1');
            expect(result.displayId).toMatch(/^TKT-/);

            // Ticket was created
            expect(prisma.ticket.create).toHaveBeenCalledTimes(1);
            const ticketData = (prisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(ticketData.source).toBe('DISCORD');
            expect(ticketData.sourceId).toBe('thread-123');
            expect(ticketData.status).toBe('OPEN');
            expect(ticketData.priority).toBe('MEDIUM');
            expect(ticketData.type).toBe('QUESTION');

            // First message was created
            expect(prisma.message.create).toHaveBeenCalledTimes(1);
            const msgData = (prisma.message.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(msgData.ticketId).toBe('ticket-1');
            expect(msgData.author).toContain('testuser');
            expect(msgData.author).toContain('user-123');
            expect(msgData.type).toBe('USER');
        });

        it('enqueues an AI_RESPONSE job for non-team-member senders', async () => {
            const msg = makeInboundMessage();
            const result = await handler.handle(msg);

            expect(result.aiJobEnqueued).toBe(true);
            expect(createJob).toHaveBeenCalledTimes(1);
            expect(createJob).toHaveBeenCalledWith('AI_RESPONSE', {
                ticketId: 'ticket-1',
                threadId: 'thread-123',
                source: 'discord',
            });
        });

        it('skips AI job when sender is a team member', async () => {
            // Set up user lookup to find a matching user with email
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: 'team@example.com',
            });
            // Set up team member lookup to find a match
            (prisma.teamMember.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'member-1',
            });

            const msg = makeInboundMessage();
            const result = await handler.handle(msg);

            expect(result.isNewTicket).toBe(true);
            expect(result.aiJobEnqueued).toBe(false);
            expect(createJob).not.toHaveBeenCalled();
        });

        it('truncates long content for title and description', async () => {
            const longContent = 'x'.repeat(5000);
            const msg = makeInboundMessage({ content: longContent });
            await handler.handle(msg);

            const ticketData = (prisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(ticketData.title.length).toBeLessThanOrEqual(200);
            expect(ticketData.description.length).toBeLessThanOrEqual(4000);
        });

        it('handles empty content gracefully (no message created)', async () => {
            const msg = makeInboundMessage({ content: '' });
            await handler.handle(msg);

            // Ticket created but message not created (content is empty)
            expect(prisma.ticket.create).toHaveBeenCalledTimes(1);
            expect(prisma.message.create).not.toHaveBeenCalled();
        });

        it('maps different TicketSource values to correct PlatformTarget in job', async () => {
            const sources: Array<{ source: TicketSource; expectedTarget: string }> = [
                { source: TicketSource.DISCORD, expectedTarget: 'discord' },
                { source: TicketSource.GITHUB_ISSUE, expectedTarget: 'github' },
                { source: TicketSource.GITHUB_DISCUSSION, expectedTarget: 'github' },
                { source: TicketSource.SLACK, expectedTarget: 'slack' },
                { source: TicketSource.TEAMS, expectedTarget: 'teams' },
                { source: TicketSource.EMAIL, expectedTarget: 'web' },
            ];

            for (const { source, expectedTarget } of sources) {
                const freshPrisma = createMockPrisma();
                const freshCreateJob = createMockCreateJob();
                const freshHandler = new InboundHandler({ prisma: freshPrisma, createJob: freshCreateJob });

                const msg = makeInboundMessage({ source });
                await freshHandler.handle(msg);

                expect(freshCreateJob).toHaveBeenCalledWith('AI_RESPONSE', expect.objectContaining({
                    source: expectedTarget,
                }));
            }
        });

        it('passes attachments to message record when present', async () => {
            const msg = makeInboundMessage({
                attachments: [
                    { filename: 'screenshot.png', url: 'https://cdn.example.com/screenshot.png', size: 1024, contentType: 'image/png' },
                ],
            });
            await handler.handle(msg);

            const msgData = (prisma.message.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(msgData.attachments).toBeDefined();
            expect(msgData.attachments[0].filename).toBe('screenshot.png');
        });

        // ── User linkage ────────────────────────────────────────────

        it('links the ticket to an existing User found by externalId + source', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-existing-1',
                email: 'existing@example.com',
            });

            const msg = makeInboundMessage();
            await handler.handle(msg);

            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: {
                    externalId: 'user-123',
                    source: 'DISCORD',
                },
            });
            expect(prisma.user.create).not.toHaveBeenCalled();

            const ticketData = (prisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(ticketData.userId).toBe('user-existing-1');
        });

        it('creates a new User with a synthesized placeholder email when none exists, and links it to the ticket', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

            const msg = makeInboundMessage();
            await handler.handle(msg);

            expect(prisma.user.create).toHaveBeenCalledWith({
                data: {
                    name: 'testuser',
                    email: 'discord-user-123@reporters.outpost.internal',
                    externalId: 'user-123',
                    source: 'DISCORD',
                },
            });

            const ticketData = (prisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(ticketData.userId).toBe('user-new-1');
        });

        it('recovers from a concurrent-create race: re-reads the User when create hits a unique violation', async () => {
            // Two first-ever messages from the same sender arrive at once: both
            // findFirst -> null, both attempt create with the same synthesized
            // (unique) email. The loser gets P2002; it must re-read and reuse the
            // winner's row, not throw and drop the ticket.
            (prisma.user.findFirst as ReturnType<typeof vi.fn>)
                .mockReset()
                // 1st: initial lookup -> null. 2nd: recovery re-read after the
                // race -> the winner's row. (A later call from isTeamMember
                // falls through to null.)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'user-raced-1', email: 'discord-user-123@reporters.outpost.internal' })
                .mockResolvedValue(null);
            (prisma.user.create as ReturnType<typeof vi.fn>)
                .mockReset()
                .mockRejectedValueOnce({ code: 'P2002' });

            const msg = makeInboundMessage();
            const result = await handler.handle(msg);

            expect(result.isNewTicket).toBe(true);
            expect(prisma.user.create).toHaveBeenCalledTimes(1);

            const ticketData = (prisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(ticketData.userId).toBe('user-raced-1');
        });

        it('rethrows a non-unique-violation create error', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
            (prisma.user.create as ReturnType<typeof vi.fn>)
                .mockReset()
                .mockRejectedValueOnce({ code: 'P1001', message: 'db unreachable' });

            await expect(handler.handle(makeInboundMessage())).rejects.toMatchObject({ code: 'P1001' });
        });
    });

    // ── Reply to existing ticket ─────────────────────────────────────

    describe('reply to existing ticket (isThreadStart=false)', () => {
        const existingTicket = {
            id: 'ticket-existing',
            displayId: 'TKT-EXISTIN',
            status: 'OPEN',
            sourceId: 'thread-123',
            channel: 'channel-1',
            source: 'DISCORD',
        };

        beforeEach(() => {
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existingTicket);
        });

        it('appends message to existing ticket', async () => {
            const msg = makeInboundMessage({ isThreadStart: false, content: 'Follow up question' });
            const result = await handler.handle(msg);

            expect(result.isNewTicket).toBe(false);
            expect(result.ticketId).toBe('ticket-existing');
            expect(result.displayId).toBe('TKT-EXISTIN');

            // No new ticket created
            expect(prisma.ticket.create).not.toHaveBeenCalled();

            // Message was appended
            expect(prisma.message.create).toHaveBeenCalledTimes(1);
            const msgData = (prisma.message.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            expect(msgData.ticketId).toBe('ticket-existing');
            expect(msgData.content).toBe('Follow up question');
        });

        it('enqueues AI_RESPONSE for non-team-member reply', async () => {
            const msg = makeInboundMessage({ isThreadStart: false });
            const result = await handler.handle(msg);

            expect(result.aiJobEnqueued).toBe(true);
            expect(createJob).toHaveBeenCalledWith('AI_RESPONSE', {
                ticketId: 'ticket-existing',
                threadId: 'thread-123',
                source: 'discord',
            });
        });

        it('skips AI_RESPONSE for team member reply', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: 'team@example.com',
            });
            (prisma.teamMember.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'member-1',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            const result = await handler.handle(msg);

            expect(result.aiJobEnqueued).toBe(false);
            expect(createJob).not.toHaveBeenCalled();
        });

        it('transitions WAITING_ON_TEAM to WAITING_ON_CUSTOMER when team member replies', async () => {
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                ...existingTicket,
                status: 'WAITING_ON_TEAM',
            });
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: 'team@example.com',
            });
            (prisma.teamMember.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'member-1',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            await handler.handle(msg);

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'ticket-existing' },
                data: { status: 'WAITING_ON_CUSTOMER' },
            });
        });

        it('does NOT transition ticket if team member replies and status is not WAITING_ON_TEAM', async () => {
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                ...existingTicket,
                status: 'OPEN',
            });
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: 'team@example.com',
            });
            (prisma.teamMember.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'member-1',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            await handler.handle(msg);

            expect(prisma.ticket.update).not.toHaveBeenCalled();
        });

        it('reopens ticket from WAITING_ON_CUSTOMER when customer replies', async () => {
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                ...existingTicket,
                status: 'WAITING_ON_CUSTOMER',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            await handler.handle(msg);

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'ticket-existing' },
                data: { status: 'OPEN' },
            });
        });

        it('reopens ticket from RESOLVED when customer replies', async () => {
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                ...existingTicket,
                status: 'RESOLVED',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            await handler.handle(msg);

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'ticket-existing' },
                data: { status: 'OPEN' },
            });
        });

        it('does NOT reopen ticket if status is OPEN or IN_PROGRESS', async () => {
            for (const status of ['OPEN', 'IN_PROGRESS']) {
                const freshPrisma = createMockPrisma();
                (freshPrisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                    ...existingTicket,
                    status,
                });
                const freshCreateJob = createMockCreateJob();
                const freshHandler = new InboundHandler({ prisma: freshPrisma, createJob: freshCreateJob });

                const msg = makeInboundMessage({ isThreadStart: false });
                await freshHandler.handle(msg);

                expect(freshPrisma.ticket.update).not.toHaveBeenCalled();
            }
        });

        it('creates new ticket if no existing ticket found for reply thread', async () => {
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

            const msg = makeInboundMessage({ isThreadStart: false });
            const result = await handler.handle(msg);

            // Falls back to creating a new ticket
            expect(result.isNewTicket).toBe(true);
            expect(prisma.ticket.create).toHaveBeenCalledTimes(1);
        });
    });

    // ── Slack composite sourceId ─────────────────────────────────────

    describe('Slack composite sourceId handling', () => {
        it('looks up Slack tickets using channelId:threadTs composite key', async () => {
            const msg = makeInboundMessage({
                source: TicketSource.SLACK,
                threadId: '1234567890.123456',
                channelId: 'C0ABCDEF1',
                isThreadStart: false,
            });

            await handler.handle(msg);

            expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
                where: {
                    source: 'SLACK',
                    sourceId: 'C0ABCDEF1:1234567890.123456',
                },
            });
        });

        it('creates Slack tickets with composite channelId:threadTs as sourceId', async () => {
            const msg = makeInboundMessage({
                source: TicketSource.SLACK,
                threadId: '1234567890.123456',
                channelId: 'C0ABCDEF1',
                isThreadStart: true,
            });

            await handler.handle(msg);

            const ticketData = (prisma.ticket.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
            // Slack tickets use composite sourceId so reply lookups match
            expect(ticketData.sourceId).toBe('C0ABCDEF1:1234567890.123456');
        });
    });

    // ── Team member detection ────────────────────────────────────────

    describe('team member detection', () => {
        it('identifies team member by User.externalId + TeamMember.email lookup', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: 'developer@company.com',
            });
            (prisma.teamMember.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'member-1',
            });

            const msg = makeInboundMessage({ isThreadStart: false });

            // Set up existing ticket for reply
            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TEST1234',
                status: 'OPEN',
                sourceId: 'thread-123',
                channel: 'channel-1',
                source: 'DISCORD',
            });

            const result = await handler.handle(msg);
            expect(result.aiJobEnqueued).toBe(false);

            // Verify User lookup used correct source
            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: {
                    externalId: 'user-123',
                    source: 'DISCORD',
                },
            });
        });

        it('returns false when user has no email', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: null,
            });

            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TEST1234',
                status: 'OPEN',
                sourceId: 'thread-123',
                channel: 'channel-1',
                source: 'DISCORD',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            const result = await handler.handle(msg);
            expect(result.aiJobEnqueued).toBe(true);
        });

        it('returns false when user not found in database', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TEST1234',
                status: 'OPEN',
                sourceId: 'thread-123',
                channel: 'channel-1',
                source: 'DISCORD',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            const result = await handler.handle(msg);
            expect(result.aiJobEnqueued).toBe(true);
        });

        it('returns false when user found but no matching team member', async () => {
            (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'user-db-1',
                email: 'outsider@other.com',
            });
            (prisma.teamMember.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

            (prisma.ticket.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TEST1234',
                status: 'OPEN',
                sourceId: 'thread-123',
                channel: 'channel-1',
                source: 'DISCORD',
            });

            const msg = makeInboundMessage({ isThreadStart: false });
            const result = await handler.handle(msg);
            expect(result.aiJobEnqueued).toBe(true);
        });
    });

    // ── Error cases ──────────────────────────────────────────────────

    describe('error cases', () => {
        it('propagates Prisma errors during ticket creation', async () => {
            (prisma.ticket.create as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('Database connection failed'),
            );

            const msg = makeInboundMessage();
            await expect(handler.handle(msg)).rejects.toThrow('Database connection failed');
        });

        it('propagates Prisma errors during message creation', async () => {
            (prisma.message.create as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('Unique constraint violation'),
            );

            const msg = makeInboundMessage();
            await expect(handler.handle(msg)).rejects.toThrow('Unique constraint violation');
        });

        it('propagates job creation errors', async () => {
            (createJob as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('Queue unavailable'),
            );

            const msg = makeInboundMessage();
            await expect(handler.handle(msg)).rejects.toThrow('Queue unavailable');
        });
    });

    // ── Custom AI job type ───────────────────────────────────────────

    describe('custom aiResponseJobType', () => {
        it('uses custom job type string when configured', async () => {
            const customHandler = new InboundHandler({
                prisma,
                createJob,
                aiResponseJobType: 'CUSTOM_AI_JOB',
            });

            const msg = makeInboundMessage();
            await customHandler.handle(msg);

            expect(createJob).toHaveBeenCalledWith('CUSTOM_AI_JOB', expect.anything());
        });
    });
});
