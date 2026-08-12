import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

// Mock shared utilities; adapter classes now come from shared/platforms
vi.mock('@copilotkit/outpost/shared', () => ({
    generateTicketId: vi.fn().mockReturnValue('TKT-AB12'),
    truncate: vi.fn((str: string, _len: number) => str),
}));

// Import the real TeamsAdapter and InboundHandler from the platforms entry point
vi.mock('@copilotkit/outpost/shared/platforms', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@copilotkit/outpost/shared/platforms')>();
    return {
        TeamsAdapter: orig.TeamsAdapter,
        InboundHandler: orig.InboundHandler,
    };
});

vi.mock('../config.js', () => ({
    config: {
        teamsAppId: 'test-app-id',
        teamsAppPassword: 'test-password',
        teamsTenantId: 'test-tenant',
        monitoredChannelIds: ['channel-1'],
    },
}));

vi.mock('botbuilder', () => ({
    CardFactory: {
        adaptiveCard: vi.fn((card: unknown) => ({ contentType: 'application/vnd.microsoft.card.adaptive', content: card })),
    },
    MessageFactory: {
        attachment: vi.fn((attachment: unknown) => ({ attachments: [attachment] })),
    },
}));

import { handleMessage } from '../handlers/message.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-AB12',
    status: 'OPEN',
    priority: 'MEDIUM',
    source: 'TEAMS',
    sourceId: 'conv-123',
};

function makeContext(overrides: Record<string, unknown> = {}) {
    const activity = {
        type: 'message',
        text: 'I need help with CopilotKit integration',
        from: {
            id: 'user-456',
            name: 'Test User',
            aadObjectId: 'aad-789',
        },
        recipient: {
            id: 'bot-id',
        },
        conversation: {
            id: 'conv-123',
        },
        channelData: {
            teamsChannelId: 'channel-1',
        },
        serviceUrl: 'https://smba.trafficmanager.net/teams/',
        replyToId: undefined,
        ...overrides,
    };

    return {
        activity,
        sendActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleMessage>[0];
}

describe('handleMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: no existing ticket
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.ticket.create).mockResolvedValue({
            id: 'ticket-internal-id',
            displayId: 'TKT-AB12',
        } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        // Default: not a team member
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.user.create).mockResolvedValue({
            id: 'user-internal-id',
        } as ReturnType<typeof prisma.user.create> extends Promise<infer T> ? T : never);
    });

    it('ignores non-message activities', async () => {
        const context = makeContext({ type: 'conversationUpdate' });
        await handleMessage(context);
        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('ignores messages from the bot itself', async () => {
        const context = makeContext({
            from: { id: 'bot-id', name: 'Bot', aadObjectId: 'bot-aad' },
            recipient: { id: 'bot-id' },
        });
        await handleMessage(context);
        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('creates a ticket for new messages in monitored channels', async () => {
        const context = makeContext();
        await handleMessage(context);

        expect(prisma.ticket.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                displayId: expect.any(String),
                source: 'TEAMS',
                sourceId: 'conv-123',
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
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
                source: 'teams',
            }),
        );

        // Should send an acknowledgment card
        expect(context.sendActivity).toHaveBeenCalled();
    });

    it('stores ConversationReference in additionalInfo when creating ticket', async () => {
        const context = makeContext();
        await handleMessage(context);

        // ConversationReference is stored via a separate update after ticket creation
        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-internal-id' },
            data: {
                additionalInfo: {
                    conversationReference: expect.objectContaining({
                        serviceUrl: 'https://smba.trafficmanager.net/teams/',
                        conversationId: 'conv-123',
                        botId: 'bot-id',
                    }),
                },
            },
        });
    });

    it('ignores messages in unmonitored channels', async () => {
        const context = makeContext({
            channelData: { teamsChannelId: 'unmonitored-channel' },
        });
        await handleMessage(context);
        expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('ignores replies in unmonitored channels before orphan fallback', async () => {
        const context = makeContext({
            replyToId: 'missing-parent-id',
            channelData: { teamsChannelId: 'unmonitored-channel' },
        });

        await handleMessage(context);

        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
        expect(prisma.ticket.create).not.toHaveBeenCalled();
        expect(prisma.message.create).not.toHaveBeenCalled();
        expect(createJob).not.toHaveBeenCalled();
        expect(context.sendActivity).not.toHaveBeenCalled();
    });

    it('appends follow-up messages to existing tickets', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never,
        );

        const context = makeContext({ replyToId: 'some-parent-id' });
        await handleMessage(context);

        // Should NOT create a new ticket
        expect(prisma.ticket.create).not.toHaveBeenCalled();

        // Should create a message record
        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                type: 'USER',
            }),
        });

        // Should NOT enqueue an AI response — one answer per ticket, on the
        // opening message only, whoever sends the follow-up.
        expect(createJob).not.toHaveBeenCalled();
    });

    it('does not enqueue AI response for team member follow-ups', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never,
        );

        // Set up as team member
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: 'team@copilotkit.ai',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
            id: 'tm-1',
        } as ReturnType<typeof prisma.teamMember.findUnique> extends Promise<infer T> ? T : never);

        const context = makeContext({ replyToId: 'some-parent-id' });
        await handleMessage(context);

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

        const context = makeContext({ replyToId: 'some-parent-id' });
        await handleMessage(context);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'OPEN' },
        });
    });
});
