import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());

import { findTicketByConversationId, isTeamMember } from '../lib/tickets.js';
import { prisma } from '@copilotkit/outpost/db';
import { TicketSource, buildTicketSourceId } from '@copilotkit/outpost/shared';

describe('findTicketByConversationId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the ticket when found', async () => {
        const ticket = { id: 'ticket-1', source: 'TEAMS', sourceId: 'conv-123' };
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(ticket as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);

        const result = await findTicketByConversationId('conv-123');

        expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
            where: {
                source: 'TEAMS',
                sourceId: 'conv-123',
            },
        });
        expect(result).toEqual(ticket);
    });

    it('queries by the sourceId buildTicketSourceId derives', async () => {
        // The reader must go through the shared helper InboundHandler writes
        // with. Inlining the conversation ID is harmless only until the
        // derivation changes, at which point reader and writer silently disagree.
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        await findTicketByConversationId('conv-abc');

        expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
            where: {
                source: 'TEAMS',
                sourceId: buildTicketSourceId(TicketSource.TEAMS, 'conv-abc'),
            },
        });
    });

    it('skips the query entirely for an unaddressable conversation', async () => {
        // buildTicketSourceId yields no key for an empty conversation ID.
        // A `sourceId: null` filter would match any keyless row, so don't query.
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        expect(await findTicketByConversationId('')).toBeNull();
        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when no ticket found', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        const result = await findTicketByConversationId('nonexistent');
        expect(result).toBeNull();
    });
});

describe('isTeamMember', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true when user is a team member', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: 'team@copilotkit.ai',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
            id: 'tm-1',
        } as ReturnType<typeof prisma.teamMember.findUnique> extends Promise<infer T> ? T : never);

        const result = await isTeamMember('aad-123');
        expect(result).toBe(true);
    });

    it('returns false when user is not found', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

        const result = await isTeamMember('unknown-user');
        expect(result).toBe(false);
    });

    it('returns false when user has no email', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: null,
        } as unknown as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);

        const result = await isTeamMember('aad-123');
        expect(result).toBe(false);
    });

    it('returns false when user is not a team member', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: 'external@example.com',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.teamMember.findUnique).mockResolvedValue(null);

        const result = await isTeamMember('aad-123');
        expect(result).toBe(false);
    });
});
