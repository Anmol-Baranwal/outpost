import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';

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
        user: {
            findFirst: vi.fn(),
        },
        teamMember: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@outpost/queue', () => ({
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

import { handleAssign } from '../commands/assign.js';
import { handleClose } from '../commands/close.js';
import { handleEscalate } from '../commands/escalate.js';
import { handlePriority } from '../commands/priority.js';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-AB12',
    status: 'OPEN',
    priority: 'MEDIUM',
    source: 'DISCORD',
    sourceId: 'thread-123',
};

function makeInteraction(options: {
    commandName?: string;
    optionValues?: Record<string, unknown>;
    channelType?: ChannelType;
    channelId?: string;
} = {}) {
    const {
        optionValues = {},
        channelType = ChannelType.PublicThread,
        channelId = 'thread-123',
    } = options;

    return {
        user: { tag: 'Admin#0001', id: 'admin-1' },
        channel: {
            type: channelType,
            id: channelId,
        },
        options: {
            getUser: vi.fn((name: string, _required?: boolean) => optionValues[name] ?? null),
            getString: vi.fn((name: string, _required?: boolean) => optionValues[name] ?? null),
        },
        reply: vi.fn().mockResolvedValue(undefined),
        replied: false,
        deferred: false,
    } as unknown as Parameters<typeof handleAssign>[0];
}

describe('handleAssign', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.ticket.update).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.note.create).mockResolvedValue({ id: 'note-1' } as ReturnType<typeof prisma.note.create> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    });

    it('assigns a ticket to a user via thread context', async () => {
        const interaction = makeInteraction({
            optionValues: {
                user: { tag: 'Engineer#1234', id: 'eng-1' },
            },
        });

        await handleAssign(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: expect.objectContaining({
                status: 'IN_PROGRESS',
            }),
        });

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('assigned'),
            }),
        );
    });

    it('assigns by explicit ticket ID', async () => {
        vi.mocked(prisma.ticket.findUnique).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findUnique> extends Promise<infer T> ? T : never);

        const interaction = makeInteraction({
            optionValues: {
                user: { tag: 'Engineer#1234', id: 'eng-1' },
                ticket: 'TKT-AB12',
            },
        });

        await handleAssign(interaction);

        expect(prisma.ticket.findUnique).toHaveBeenCalledWith({
            where: { displayId: 'TKT-AB12' },
        });
        expect(prisma.ticket.update).toHaveBeenCalled();
    });

    it('errors when used outside a thread without a ticket ID', async () => {
        const interaction = makeInteraction({
            optionValues: {
                user: { tag: 'Engineer#1234', id: 'eng-1' },
            },
            channelType: ChannelType.GuildText,
        });

        await handleAssign(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('support thread'),
                ephemeral: true,
            }),
        );
    });
});

describe('handleClose', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.ticket.update).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.note.create).mockResolvedValue({ id: 'note-1' } as ReturnType<typeof prisma.note.create> extends Promise<infer T> ? T : never);
    });

    it('closes the ticket with a reason', async () => {
        const interaction = makeInteraction({
            optionValues: { reason: 'Duplicate issue' },
        });

        await handleClose(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'CLOSED' },
        });

        expect(prisma.note.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                content: expect.stringContaining('Duplicate issue'),
            }),
        });

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('closed'),
            }),
        );
    });

    it('uses default reason when none provided', async () => {
        const interaction = makeInteraction();
        await handleClose(interaction);

        expect(prisma.note.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                content: expect.stringContaining('Resolved'),
            }),
        });
    });

    it('errors when no ticket found', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);
        const interaction = makeInteraction();
        await handleClose(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('No ticket found'),
                ephemeral: true,
            }),
        );
    });
});

describe('handleEscalate', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.ticket.update).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.note.create).mockResolvedValue({ id: 'note-1' } as ReturnType<typeof prisma.note.create> extends Promise<infer T> ? T : never);
    });

    it('escalates the ticket to HIGH priority', async () => {
        const interaction = makeInteraction({
            optionValues: { reason: 'Production is down' },
        });

        await handleEscalate(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: {
                priority: 'HIGH',
                status: 'WAITING_ON_TEAM',
            },
        });

        expect(createJob).toHaveBeenCalledWith(
            JobType.ESCALATION,
            expect.objectContaining({
                ticketId: 'ticket-1',
                reason: expect.stringContaining('Production is down'),
            }),
        );
    });

    it('keeps CRITICAL priority if already critical', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
            ...TICKET,
            priority: 'CRITICAL',
        } as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);

        const interaction = makeInteraction();
        await handleEscalate(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: expect.objectContaining({
                priority: 'CRITICAL',
            }),
        });
    });

    it('errors when used outside a thread', async () => {
        const interaction = makeInteraction({
            channelType: ChannelType.GuildText,
        });

        await handleEscalate(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                ephemeral: true,
            }),
        );
        expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
});

describe('handlePriority', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.ticket.update).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.note.create).mockResolvedValue({ id: 'note-1' } as ReturnType<typeof prisma.note.create> extends Promise<infer T> ? T : never);
    });

    it('updates ticket priority to the specified level', async () => {
        const interaction = makeInteraction({
            optionValues: { level: 'high' },
        });

        await handlePriority(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { priority: 'HIGH' },
        });

        expect(prisma.note.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                content: expect.stringContaining('MEDIUM to HIGH'),
            }),
        });

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('HIGH'),
            }),
        );
    });

    it('errors when no ticket found', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        const interaction = makeInteraction({
            optionValues: { level: 'low' },
        });

        await handlePriority(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('No ticket found'),
                ephemeral: true,
            }),
        );
    });

    it('errors when used outside a thread', async () => {
        const interaction = makeInteraction({
            optionValues: { level: 'critical' },
            channelType: ChannelType.GuildText,
        });

        await handlePriority(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                ephemeral: true,
            }),
        );
        expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
});
