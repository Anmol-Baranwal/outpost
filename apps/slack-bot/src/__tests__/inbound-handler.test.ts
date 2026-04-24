import { describe, it, expect, vi, beforeEach } from 'vitest';

// We don't need @slack/web-api for these tests but the shared module
// imports it for SlackAdapter, so provide a lightweight stub.
const { MockWebClient } = vi.hoisted(() => {
    class MockWebClient {}
    return { MockWebClient };
});
vi.mock('@slack/web-api', () => ({
    WebClient: MockWebClient,
}));

import { InboundHandler } from '@copilotkit/outpost/shared';
import type { InboundMessage, InboundPrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import { TicketSource } from '@copilotkit/outpost/shared';

function makeMockPrisma(): InboundPrismaLike {
    return {
        ticket: {
            create: vi.fn().mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-IH01',
                status: 'OPEN',
                sourceId: 'C_CHAN:1234567890.123456',
                channel: 'C_CHAN',
                source: 'SLACK',
            }),
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({}),
        },
        message: {
            create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
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

function makeNewMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
        platformUserId: 'U_EXTERNAL',
        platformUsername: 'slack:U_EXTERNAL',
        content: 'Help with integration',
        channelId: 'C_CHAN',
        threadId: '1234567890.123456',
        sourceUrl: 'https://slack.com/archives/C_CHAN/p1234567890123456',
        source: TicketSource.SLACK,
        isThreadStart: true,
        rawEvent: {},
        ...overrides,
    };
}

function makeThreadReply(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
        platformUserId: 'U_EXTERNAL',
        platformUsername: 'slack:U_EXTERNAL',
        content: 'Follow-up question',
        channelId: 'C_CHAN',
        threadId: '1234567890.123456',
        sourceUrl: 'https://slack.com/archives/C_CHAN/p1234567890123456',
        source: TicketSource.SLACK,
        isThreadStart: false,
        rawEvent: {},
        ...overrides,
    };
}

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-IH01',
    status: 'OPEN',
    sourceId: 'C_CHAN:1234567890.123456',
    channel: 'C_CHAN',
    source: 'SLACK',
};

describe('InboundHandler (Slack-focused)', () => {
    let mockPrisma: InboundPrismaLike;
    let mockCreateJob: ReturnType<typeof vi.fn>;
    let handler: InboundHandler;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma = makeMockPrisma();
        mockCreateJob = vi.fn().mockResolvedValue('job-123');
        handler = new InboundHandler({
            prisma: mockPrisma,
            createJob: mockCreateJob as CreateJobFn,
        });
    });

    describe('new top-level messages', () => {
        it('creates a ticket and enqueues AI response', async () => {
            const result = await handler.handle(makeNewMessage());

            expect(result.isNewTicket).toBe(true);
            expect(result.ticketId).toBe('ticket-1');
            expect(result.displayId).toMatch(/^TKT-[A-Z0-9]{8}$/);

            expect(mockPrisma.ticket.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    displayId: expect.stringMatching(/^TKT-[A-Z0-9]{8}$/),
                    source: 'SLACK',
                    status: 'OPEN',
                    priority: 'MEDIUM',
                    type: 'QUESTION',
                    channel: 'C_CHAN',
                }),
            });

            expect(mockPrisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    type: 'USER',
                }),
            });

            expect(mockCreateJob).toHaveBeenCalledWith(
                'AI_RESPONSE',
                expect.objectContaining({
                    ticketId: 'ticket-1',
                    source: 'slack',
                }),
            );
        });
    });

    describe('threaded replies', () => {
        beforeEach(() => {
            vi.mocked(mockPrisma.ticket.findFirst).mockResolvedValue(TICKET);
        });

        it('appends a message and enqueues AI response for non-team-members', async () => {
            const result = await handler.handle(makeThreadReply());

            expect(result.isNewTicket).toBe(false);
            expect(result.ticketId).toBe('ticket-1');
            expect(result.displayId).toBe('TKT-IH01');

            expect(mockPrisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    type: 'USER',
                }),
            });

            expect(mockCreateJob).toHaveBeenCalledWith(
                'AI_RESPONSE',
                expect.objectContaining({
                    ticketId: 'ticket-1',
                    source: 'slack',
                }),
            );
        });

        it('reopens RESOLVED ticket when customer replies', async () => {
            vi.mocked(mockPrisma.ticket.findFirst).mockResolvedValue({
                ...TICKET,
                status: 'RESOLVED',
            });

            await handler.handle(makeThreadReply());

            expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'ticket-1' },
                data: { status: 'OPEN' },
            });
        });

        it('creates new ticket for untracked threads', async () => {
            vi.mocked(mockPrisma.ticket.findFirst).mockResolvedValue(null);

            const result = await handler.handle(makeThreadReply());

            // Falls back to creating a new ticket
            expect(result.isNewTicket).toBe(true);
        });

        it('looks up ticket by source and sourceId', async () => {
            await handler.handle(makeThreadReply());

            expect(mockPrisma.ticket.findFirst).toHaveBeenCalledWith({
                where: {
                    source: 'SLACK',
                    sourceId: 'C_CHAN:1234567890.123456',
                },
            });
        });
    });
});
