import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

import { handleButtonInteraction } from '../interactions/buttons.js';
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

function makeButtonInteraction(customId: string, overrides: Record<string, unknown> = {}) {
    return {
        customId,
        user: { tag: 'TestUser#1234', id: 'user-456' },
        channel: {
            type: ChannelType.PublicThread,
            id: 'thread-123',
        },
        reply: vi.fn().mockResolvedValue(undefined),
        isButton: () => true,
        ...overrides,
    } as unknown as Parameters<typeof handleButtonInteraction>[0];
}

describe('handleButtonInteraction', () => {
    beforeEach(() => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.ticket.update).mockResolvedValue(TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
    });

    it('closes the ticket when "Issue Solved" is clicked', async () => {
        const interaction = makeButtonInteraction('issue_solved');
        await handleButtonInteraction(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'CLOSED' },
        });

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('Glad we could help'),
            }),
        );
    });

    it('logs a system message when issue is solved', async () => {
        const interaction = makeButtonInteraction('issue_solved');
        await handleButtonInteraction(interaction);

        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                type: 'SYSTEM',
                content: expect.stringContaining('solved'),
            }),
        });
    });

    it('escalates when "Need more help" is clicked', async () => {
        const interaction = makeButtonInteraction('need_more_help');
        await handleButtonInteraction(interaction);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'WAITING_ON_TEAM' },
        });

        expect(createJob).toHaveBeenCalledWith(
            JobType.ESCALATION,
            expect.objectContaining({
                ticketId: 'ticket-1',
                reason: expect.stringContaining('Need more help'),
            }),
        );

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('team member has been notified'),
            }),
        );
    });

    it('shows error when used outside a thread', async () => {
        const interaction = makeButtonInteraction('issue_solved', {
            channel: { type: ChannelType.GuildText, id: 'chan-1' },
        });
        await handleButtonInteraction(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('support thread'),
                ephemeral: true,
            }),
        );
        expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('shows error when no ticket found', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);
        const interaction = makeButtonInteraction('issue_solved');
        await handleButtonInteraction(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('No ticket found'),
                ephemeral: true,
            }),
        );
    });

    it('ignores unknown button IDs', async () => {
        const interaction = makeButtonInteraction('unknown_button');
        await handleButtonInteraction(interaction);

        expect(prisma.ticket.update).not.toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});
