import { prisma } from '@copilotkit/outpost/db';
import { TicketSource, buildTicketSourceId } from '@copilotkit/outpost/shared';

/**
 * Find a ticket by its Discord thread ID (stored as sourceId with source=DISCORD).
 *
 * The key is built by buildTicketSourceId — the same helper InboundHandler and
 * shadow mode store tickets with — so this lookup can never search for a
 * spelling nothing was written under. For Discord that is the thread ID
 * verbatim today, but routing through the helper is what keeps it that way: the
 * next change to the derivation moves writer and reader together.
 *
 * A null key (no thread ID) means no ticket can carry it, so there is nothing
 * to query — returning early also stops a `sourceId: null` filter from matching
 * an unrelated keyless row.
 */
export async function findTicketByThreadId(threadId: string) {
    const sourceId = buildTicketSourceId(TicketSource.DISCORD, threadId);
    if (sourceId === null) return null;

    return prisma.ticket.findFirst({
        where: {
            source: 'DISCORD',
            sourceId,
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
