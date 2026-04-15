import { prisma } from '@outpost/db';

/**
 * Find a ticket by its Discord thread ID (stored as sourceId with source=DISCORD).
 */
export async function findTicketByThreadId(threadId: string) {
    return prisma.ticket.findFirst({
        where: {
            source: 'DISCORD',
            sourceId: threadId,
        },
    });
}

/**
 * Determine if a Discord user ID belongs to a team member.
 * Team members have their Discord ID stored as externalId on a User
 * that is linked to a TeamMember via email.
 */
export async function isTeamMember(discordUserId: string): Promise<boolean> {
    const user = await prisma.user.findFirst({
        where: {
            externalId: discordUserId,
            source: 'DISCORD',
        },
    });

    if (!user?.email) return false;

    const member = await prisma.teamMember.findUnique({
        where: { email: user.email },
    });

    return member !== null;
}
