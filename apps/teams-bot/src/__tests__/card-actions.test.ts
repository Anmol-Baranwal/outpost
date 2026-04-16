import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

vi.mock('botbuilder', () => ({
    CardFactory: {
        adaptiveCard: vi.fn((card: unknown) => ({ contentType: 'application/vnd.microsoft.card.adaptive', content: card })),
    },
    MessageFactory: {
        attachment: vi.fn((attachment: unknown) => ({ attachments: [attachment] })),
    },
}));

import { handleCardAction } from '../handlers/card-actions.js';
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

function makeCardContext(action: string, overrides: Record<string, unknown> = {}) {
    return {
        activity: {
            type: 'invoke',
            value: {
                action,
                ticketDisplayId: 'TKT-AB12',
            },
            from: {
                id: 'user-456',
                name: 'Test User',
                aadObjectId: 'aad-789',
            },
            conversation: {
                id: 'conv-123',
            },
            ...overrides,
        },
        sendActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleCardAction>[0];
}

describe('handleCardAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never,
        );
        vi.mocked(prisma.ticket.update).mockResolvedValue(
            TICKET as ReturnType<typeof prisma.ticket.update> extends Promise<infer T> ? T : never,
        );
        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);
    });

    it('closes the ticket when "Issue Solved" is clicked', async () => {
        const context = makeCardContext('issue_solved');
        await handleCardAction(context);

        expect(prisma.ticket.update).toHaveBeenCalledWith({
            where: { id: 'ticket-1' },
            data: { status: 'CLOSED' },
        });

        expect(context.sendActivity).toHaveBeenCalledWith(
            expect.stringContaining('Glad we could help'),
        );
    });

    it('logs a system message when issue is solved', async () => {
        const context = makeCardContext('issue_solved');
        await handleCardAction(context);

        expect(prisma.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ticketId: 'ticket-1',
                type: 'SYSTEM',
                content: expect.stringContaining('solved'),
            }),
        });
    });

    it('escalates when "Need more help" is clicked', async () => {
        const context = makeCardContext('need_more_help');
        await handleCardAction(context);

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
    });

    it('sends error when no ticket found', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);
        const context = makeCardContext('issue_solved');
        await handleCardAction(context);

        expect(context.sendActivity).toHaveBeenCalledWith('No ticket found for this conversation.');
        expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('ignores unknown actions', async () => {
        const context = makeCardContext('unknown_action');
        await handleCardAction(context);

        expect(prisma.ticket.update).not.toHaveBeenCalled();
        expect(context.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores when no action data present', async () => {
        const context = {
            activity: {
                type: 'invoke',
                value: undefined,
                from: { id: 'user-456', name: 'Test User' },
                conversation: { id: 'conv-123' },
            },
            sendActivity: vi.fn(),
        } as unknown as Parameters<typeof handleCardAction>[0];

        await handleCardAction(context);
        expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
});
