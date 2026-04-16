import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        ticket: {
            findFirst: vi.fn(),
        },
        user: {
            findFirst: vi.fn(),
        },
        teamMember: {
            findUnique: vi.fn(),
        },
    },
}));

import { findTicketByConversationId, isTeamMember } from '../lib/tickets.js';
import { prisma } from '@copilotkit/outpost/db';

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
