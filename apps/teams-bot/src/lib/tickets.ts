import { prisma } from '@copilotkit/outpost/db';
import { TicketSource, buildTicketSourceId } from '@copilotkit/outpost/shared';

/**
 * Find a ticket by its Teams conversation ID (stored as sourceId with source=TEAMS).
 *
 * The key is built by buildTicketSourceId — the same helper InboundHandler
 * stores tickets with — so this lookup can never search for a spelling nothing
 * was written under. For Teams that is the conversation ID verbatim today, but
 * routing through the helper is what keeps it that way: the next change to the
 * derivation moves writer and reader together.
 *
 * A null key (no conversation ID) means no ticket can carry it, so there is
 * nothing to query — returning early also stops a `sourceId: null` filter from
 * matching an unrelated keyless row.
 */
export async function findTicketByConversationId(conversationId: string) {
    const sourceId = buildTicketSourceId(TicketSource.TEAMS, conversationId);
    if (sourceId === null) return null;

    return prisma.ticket.findFirst({
        where: {
            source: 'TEAMS',
            sourceId,
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
