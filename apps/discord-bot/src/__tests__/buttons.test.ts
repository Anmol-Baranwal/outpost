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

// `mockPrisma()` (see ./helpers/mocks.ts) does not yet stub
// `message.findFirst`/`message.update` — add them here so the feedback-write
// assertions below have something to spy on.
type PrismaMessageMock = {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
};
const mockMessage = prisma.message as unknown as PrismaMessageMock;
mockMessage.findFirst = vi.fn();
mockMessage.update = vi.fn();

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
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T>
                ? T
                : never,
        );
        vi.mocked(prisma.ticket.update).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never,
        );
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.message.findFirst).mockResolvedValue(
            null as ReturnType<typeof prisma.message.findFirst> extends Promise<infer T>
                ? T
                : never,
        );
        vi.mocked(prisma.message.update).mockResolvedValue({
            id: 'msg-ai-1',
        } as ReturnType<typeof prisma.message.update> extends Promise<infer T> ? T : never);
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

    it('writes POSITIVE feedback to the latest AI message when issue is solved', async () => {
        vi.mocked(prisma.message.findFirst).mockResolvedValue({
            id: 'msg-ai-1',
        } as ReturnType<typeof prisma.message.findFirst> extends Promise<infer T> ? T : never);

        const interaction = makeButtonInteraction('issue_solved');
        await handleButtonInteraction(interaction);

        expect(prisma.message.findFirst).toHaveBeenCalledWith({
            where: { ticketId: 'ticket-1', isAiGenerated: true, feedback: null },
            orderBy: { createdAt: 'desc' },
        });
        expect(prisma.message.update).toHaveBeenCalledWith({
            where: { id: 'msg-ai-1' },
            data: { feedback: 'POSITIVE' },
        });
    });

    it('writes NEGATIVE feedback to the latest AI message when "Need more help" is clicked', async () => {
        vi.mocked(prisma.message.findFirst).mockResolvedValue({
            id: 'msg-ai-1',
        } as ReturnType<typeof prisma.message.findFirst> extends Promise<infer T> ? T : never);

        const interaction = makeButtonInteraction('need_more_help');
        await handleButtonInteraction(interaction);

        expect(prisma.message.findFirst).toHaveBeenCalledWith({
            where: { ticketId: 'ticket-1', isAiGenerated: true, feedback: null },
            orderBy: { createdAt: 'desc' },
        });
        expect(prisma.message.update).toHaveBeenCalledWith({
            where: { id: 'msg-ai-1' },
            data: { feedback: 'NEGATIVE' },
        });
    });

    it('does not throw when no un-fed-back AI message exists', async () => {
        vi.mocked(prisma.message.findFirst).mockResolvedValue(
            null as ReturnType<typeof prisma.message.findFirst> extends Promise<infer T>
                ? T
                : never,
        );

        const interaction = makeButtonInteraction('issue_solved');
        await expect(handleButtonInteraction(interaction)).resolves.not.toThrow();

        expect(prisma.message.update).not.toHaveBeenCalled();
    });
});
