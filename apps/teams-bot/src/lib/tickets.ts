import { prisma } from '@copilotkit/outpost/db';

/**
 * Find a ticket by its Teams conversation ID (stored as sourceId with source=TEAMS).
 */
export async function findTicketByConversationId(conversationId: string) {
    return prisma.ticket.findFirst({
        where: {
            source: 'TEAMS',
            sourceId: conversationId,
        },
    });
}

/**
 * Determine if a Teams user ID belongs to a team member.
 * Team members have their Teams AAD ID stored as externalId on a User
 * that is linked to a TeamMember via email.
 */
export async function isTeamMember(teamsUserId: string): Promise<boolean> {
    const user = await prisma.user.findFirst({
        where: {
            externalId: teamsUserId,
            source: 'TEAMS',
        },
    });

    if (!user?.email) return false;

    const member = await prisma.teamMember.findUnique({
        where: { email: user.email },
    });

    return member !== null;
}
