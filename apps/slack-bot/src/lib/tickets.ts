import { prisma } from '@copilotkit/outpost/db';
import { TicketSource, buildTicketSourceId } from '@copilotkit/outpost/shared';
import { config } from '../config.js';

/**
 * Find a ticket by its Slack thread timestamp and channel ID.
 *
 * The composite "channelId:threadTs" key is built by buildTicketSourceId — the
 * same helper InboundHandler stores tickets with — so this lookup can never
 * search for a spelling nothing was written under. A null key (missing channel
 * or ts) means no ticket can carry it, so there is nothing to query.
 */
export async function findTicketByThreadTs(channelId: string, threadTs: string) {
    const sourceId = buildTicketSourceId(TicketSource.SLACK, threadTs, channelId);
    if (sourceId === null) return null;

    return prisma.ticket.findFirst({
        where: {
            source: 'SLACK',
            sourceId,
        },
    });
}

/**
 * Determine if a Slack user ID belongs to a team member.
 * Team members have their Slack ID stored as externalId on a User
 * that is linked to a TeamMember via email.
 */
export async function isTeamMember(slackUserId: string): Promise<boolean> {
    if (config.teamMemberIds.includes(slackUserId)) return true;

    const user = await prisma.user.findFirst({
        where: {
            externalId: slackUserId,
            source: 'SLACK',
        },
    });

    if (!user?.email) return false;

    const member = await prisma.teamMember.findUnique({
        where: { email: user.email },
    });

    return member !== null;
}

/**
 * Build a Slack permalink URL for a thread message.
 */
export function buildPermalink(channelId: string, threadTs: string): string {
    // Slack permalinks use the format: /archives/CHANNEL_ID/pTIMESTAMP
    // The timestamp has dots removed
    const tsNoDot = threadTs.replace('.', '');
    return `https://slack.com/archives/${channelId}/p${tsNoDot}`;
}
