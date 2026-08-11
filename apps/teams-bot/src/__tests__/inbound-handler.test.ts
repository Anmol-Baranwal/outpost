import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboundHandler } from '@copilotkit/outpost/shared/platforms';
import type { InboundPrismaLike as PrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import type { InboundMessage } from '@copilotkit/outpost/shared';
import { TicketSource } from '@copilotkit/outpost/shared';

function makePrisma(): PrismaLike {
    return {
        ticket: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({
                id: 'new-ticket-id',
                displayId: 'TKT-TEST01',
                status: 'OPEN',
                sourceId: 'conv-100',
                channel: 'ch-1',
                source: 'TEAMS',
            }),
            update: vi.fn().mockResolvedValue({}),
        },
        message: {
            create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
        },
        user: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'user-1' }),
        },
        teamMember: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        ticketExternalLink: {
            create: vi.fn().mockResolvedValue({ id: 'link-1' }),
        },
    };
}

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
        platformUserId: 'user-jane',
        platformUsername: 'Jane',
        content: 'I need help with the SDK',
        channelId: 'ch-1',
        threadId: 'conv-100',
        sourceUrl: 'https://teams.microsoft.com/l/message/conv-100',
        source: TicketSource.TEAMS,
        isThreadStart: true,
        rawEvent: {},
        ...overrides,
    };
}

describe('InboundHandler (Teams-focused)', () => {
    let prisma: ReturnType<typeof makePrisma>;
    let createJob: ReturnType<typeof vi.fn>;
    let handler: InboundHandler;

    beforeEach(() => {
        prisma = makePrisma();
        createJob = vi.fn().mockResolvedValue('job-1');
        handler = new InboundHandler({
            prisma,
            createJob: createJob as CreateJobFn,
        });
    });

    describe('new ticket creation', () => {
        it('creates a ticket for a new top-level message', async () => {
            const result = await handler.handle(makeMessage());

            expect(result).not.toBeNull();
            expect(result.isNewTicket).toBe(true);
            expect(result.ticketId).toBe('new-ticket-id');
            expect(result.displayId).toMatch(/^TKT-/);
        });

        it('calls prisma.ticket.create with correct data', async () => {
            await handler.handle(makeMessage());

            expect(prisma.ticket.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    source: 'TEAMS',
                    sourceId: 'conv-100',
                    status: 'OPEN',
                    priority: 'MEDIUM',
                    type: 'QUESTION',
                    sourceUrl: 'https://teams.microsoft.com/l/message/conv-100',
                    channel: 'ch-1',
                }),
            });
        });

        it('creates an initial message record', async () => {
            await handler.handle(makeMessage());

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'new-ticket-id',
                    type: 'USER',
                }),
            });
        });

        it('enqueues an AI response job', async () => {
            await handler.handle(makeMessage());

            expect(createJob).toHaveBeenCalledWith('AI_RESPONSE', {
                ticketId: 'new-ticket-id',
                threadId: 'conv-100',
                source: 'teams',
            });
        });

        it('skips message record when content is empty', async () => {
            await handler.handle(makeMessage({ content: '' }));

            // Ticket still created
            expect(prisma.ticket.create).toHaveBeenCalled();
            // But no message record
            expect(prisma.message.create).not.toHaveBeenCalled();
        });
    });

    describe('follow-up messages', () => {
        const EXISTING_TICKET = {
            id: 'existing-ticket-id',
            displayId: 'TKT-EXIST1',
            status: 'OPEN',
            sourceId: 'conv-100',
            channel: 'ch-1',
            source: 'TEAMS',
        };

        beforeEach(() => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue(EXISTING_TICKET);
        });

        it('appends a message to the existing ticket', async () => {
            const result = await handler.handle(makeMessage({ isThreadStart: false }));

            expect(result).not.toBeNull();
            expect(result.isNewTicket).toBe(false);
            expect(result.ticketId).toBe('existing-ticket-id');
            expect(result.displayId).toBe('TKT-EXIST1');

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'existing-ticket-id',
                    type: 'USER',
                }),
            });
        });

        // One response per ticket — follow-up messages are recorded, not answered.
        it('does not enqueue an AI response for non-team-member follow-ups', async () => {
            await handler.handle(makeMessage({ isThreadStart: false }));

            expect(createJob).not.toHaveBeenCalled();
        });

        it('transitions WAITING_ON_TEAM to WAITING_ON_CUSTOMER for team member messages', async () => {
            // Set up team member detection
            vi.mocked(prisma.user.findFirst).mockResolvedValue({
                id: 'u-1',
                email: 'team@example.com',
            });
            vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
                id: 'tm-1',
            });

            vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
                ...EXISTING_TICKET,
                status: 'WAITING_ON_TEAM',
            });

            await handler.handle(makeMessage({ isThreadStart: false }));

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'existing-ticket-id' },
                data: { status: 'WAITING_ON_CUSTOMER' },
            });
        });

        it('does not change OPEN status for team member messages', async () => {
            vi.mocked(prisma.user.findFirst).mockResolvedValue({
                id: 'u-1',
                email: 'team@example.com',
            });
            vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
                id: 'tm-1',
            });

            await handler.handle(makeMessage({ isThreadStart: false }));

            expect(prisma.ticket.update).not.toHaveBeenCalled();
        });

        it('reopens RESOLVED tickets on customer follow-up', async () => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
                ...EXISTING_TICKET,
                status: 'RESOLVED',
            });

            await handler.handle(makeMessage({ isThreadStart: false }));

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'existing-ticket-id' },
                data: { status: 'OPEN' },
            });
        });

        it('reopens WAITING_ON_CUSTOMER tickets on customer follow-up', async () => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
                ...EXISTING_TICKET,
                status: 'WAITING_ON_CUSTOMER',
            });

            await handler.handle(makeMessage({ isThreadStart: false }));

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'existing-ticket-id' },
                data: { status: 'OPEN' },
            });
        });

        it('does not reopen IN_PROGRESS tickets', async () => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
                ...EXISTING_TICKET,
                status: 'IN_PROGRESS',
            });

            await handler.handle(makeMessage({ isThreadStart: false }));

            expect(prisma.ticket.update).not.toHaveBeenCalled();
        });
    });
});
