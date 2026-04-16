import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';

vi.mock('@copilotkit/outpost/db', () => ({
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
        user: {
            findFirst: vi.fn(),
        },
        teamMember: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@copilotkit/outpost/queue', () => ({
    createJob: vi.fn().mockResolvedValue('job-123'),
    JobType: {
        AI_RESPONSE: 'AI_RESPONSE',
        TICKET_CLASSIFY: 'TICKET_CLASSIFY',
        SLA_CHECK: 'SLA_CHECK',
        ESCALATION: 'ESCALATION',
        ONBOARDING_DIGEST: 'ONBOARDING_DIGEST',
        ACCOUNT_SCORING: 'ACCOUNT_SCORING',
        HUBSPOT_SYNC: 'HUBSPOT_SYNC',
    },
}));

vi.mock('../lib/shadow-mode.js', () => ({
    isShadowMode: vi.fn().mockReturnValue(false),
    handleShadowMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    truncate: vi.fn((str: string, _len: number) => str),
}));

import { handleMessageCreate } from '../events/message-create.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-AB12',
    status: 'OPEN',
    priority: 'MEDIUM',
    source: 'DISCORD',
    sourceId: 'thread-123',
};

function makeMessage(overrides: Record<string, unknown> = {}) {
    return {
        author: {
            bot: false,
            tag: 'TestUser#1234',
            id: 'user-456',
        },
        content: 'I still need help with this',
        channel: {
            type: ChannelType.PublicThread,
            id: 'thread-123',
        },
        ...overrides,
    } as unknown as Parameters<typeof handleMessageCreate>[0];
}

describe('handleMessageCreate', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        // Default: not a team member
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    });

    it('ignores messages from bots', async () => {
        const message = makeMessage({ author: { bot: true, tag: 'Bot', id: 'bot-1' } });
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
        expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('appends a message and enqueues AI response for non-team-member', async () => {
        const message = makeMessage();
        await handleMessageCreate(message);

        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                type: 'USER',
            }),
        });

        expect(createJob).toHaveBeenCalledWith(
            JobType.AI_RESPONSE,
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

        const message = makeMessage();
        await handleMessageCreate(message);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'OPEN' },
        });
    });
});
