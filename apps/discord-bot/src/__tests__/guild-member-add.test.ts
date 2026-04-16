import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the handler
vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        onboardingMember: {
            upsert: vi.fn(),
        },
    },
}));

vi.mock('../config.js', () => ({
    config: {
        discordToken: 'test-token',
        clientId: 'test-client-id',
        guildId: 'test-guild-id',
        monitoredChannelIds: ['forum-channel-1'],
    },
}));

import { handleGuildMemberAdd } from '../events/guild-member-add.js';
import { prisma } from '@copilotkit/outpost/db';

function makeMember(overrides: Record<string, unknown> = {}) {
    return {
        id: 'member-123',
        joinedAt: new Date('2026-04-15T10:00:00Z'),
        user: {
            bot: false,
            tag: 'TestUser#1234',
            id: 'user-456',
            ...((overrides.user as Record<string, unknown>) ?? {}),
        },
        ...overrides,
    } as unknown as Parameters<typeof handleGuildMemberAdd>[0];
}

describe('handleGuildMemberAdd', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.onboardingMember.upsert).mockResolvedValue({
            id: 'om-internal-id',
        } as ReturnType<typeof prisma.onboardingMember.upsert> extends Promise<infer T> ? T : never);
    });

    it('ignores bot members', async () => {
        const member = makeMember({ user: { bot: true, tag: 'Bot#0000', id: 'bot-1' } });
        await handleGuildMemberAdd(member);
        expect(prisma.onboardingMember.upsert).not.toHaveBeenCalled();
    });

    it('records a new human member in the database', async () => {
        const member = makeMember();
        await handleGuildMemberAdd(member);

        expect(prisma.onboardingMember.upsert).toHaveBeenCalledOnce();
        expect(prisma.onboardingMember.upsert).toHaveBeenCalledWith({
            where: { discordId: 'member-123' },
            update: {
                username: 'TestUser#1234',
            },
            create: expect.objectContaining({
                discordId: 'member-123',
                username: 'TestUser#1234',
                funnelStage: 'JOINED',
                contacted: false,
                responded: false,
                meetingBooked: false,
            }),
        });
    });

    it('uses the member joinedAt date', async () => {
        const joinDate = new Date('2026-04-10T08:30:00Z');
        const member = makeMember({ joinedAt: joinDate });
        await handleGuildMemberAdd(member);

        const callArg = vi.mocked(prisma.onboardingMember.upsert).mock.calls[0][0];
        expect(callArg.create.joinedAt).toBe(joinDate);
    });

    it('falls back to current date when joinedAt is null', async () => {
        const member = makeMember({ joinedAt: null });
        await handleGuildMemberAdd(member);

        const callArg = vi.mocked(prisma.onboardingMember.upsert).mock.calls[0][0];
        expect(callArg.create.joinedAt).toBeInstanceOf(Date);
    });

    it('handles database errors gracefully without throwing', async () => {
        vi.mocked(prisma.onboardingMember.upsert).mockRejectedValue(
            new Error('Connection refused'),
        );

        const member = makeMember();
        // Should not throw
        await expect(handleGuildMemberAdd(member)).resolves.toBeUndefined();
    });
});
