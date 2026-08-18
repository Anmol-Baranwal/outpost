import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma } from './helpers/mocks.js';

vi.mock('@copilotkit/outpost/db', () => mockPrisma());

import { findTicketByThreadId, isTeamMember } from '../lib/tickets.js';
import { prisma } from '@copilotkit/outpost/db';
import { TicketSource, buildTicketSourceId } from '@copilotkit/outpost/shared';

describe('findTicketByThreadId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('queries by the sourceId buildTicketSourceId derives', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        await findTicketByThreadId('thread-123');

        expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
            where: {
                source: 'DISCORD',
                sourceId: buildTicketSourceId(TicketSource.DISCORD, 'thread-123'),
            },
        });
        // Pinned literal too, so a derivation change has to be a deliberate act
        // in both writer and reader rather than a silently-agreeing tautology.
        expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
            where: { source: 'DISCORD', sourceId: 'thread-123' },
        });
    });

    it('returns the ticket when found', async () => {
        const ticket = { id: 'ticket-1', source: 'DISCORD', sourceId: 'thread-123' };
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
            ticket as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never,
        );

        expect(await findTicketByThreadId('thread-123')).toEqual(ticket);
    });

    it('returns null when no ticket found', async () => {
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        expect(await findTicketByThreadId('nonexistent')).toBeNull();
    });

    it('skips the query entirely for an unaddressable thread', async () => {
        // buildTicketSourceId yields no key for an empty thread ID. Falling
        // through to `sourceId: null` would match any keyless row and hand back
        // an unrelated ticket, so the lookup must not run at all.
        vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

        expect(await findTicketByThreadId('')).toBeNull();
        expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    });
});

describe('isTeamMember', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true when the user maps to a TeamMember', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: 'team@copilotkit.ai',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
        vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
            id: 'tm-1',
        } as ReturnType<typeof prisma.teamMember.findUnique> extends Promise<infer T> ? T : never);

        expect(await isTeamMember('discord-user-1')).toBe(true);
        expect(prisma.user.findFirst).toHaveBeenCalledWith({
            where: { externalId: 'discord-user-1', source: 'DISCORD' },
        });
    });

    it('returns false when no User row exists', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

        expect(await isTeamMember('unknown')).toBe(false);
    });

    it('returns false when the User has no email', async () => {
        // `email` is non-nullable in the schema, so "no email" surfaces as the
        // empty string — which the `!user?.email` guard must still reject.
        vi.mocked(prisma.user.findFirst).mockResolvedValue({
            id: 'u-1',
            email: '',
        } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);

        expect(await isTeamMember('no-email')).toBe(false);
        expect(prisma.teamMember.findUnique).not.toHaveBeenCalled();
    });
});
