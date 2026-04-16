import { prisma } from '@outpost/db';
import { config } from '../config.js';

/**
 * Find a ticket by its GitHub issue/discussion source ID.
 * The sourceId format is "owner/repo#number" (e.g. "CopilotKit/CopilotKit#123").
 * Matches both GITHUB_ISSUE and GITHUB_DISCUSSION sources.
 */
export async function findTicketBySourceId(sourceId: string) {
    return prisma.ticket.findFirst({
        where: {
            sourceId,
            source: {
                in: ['GITHUB_ISSUE', 'GITHUB_DISCUSSION'],
            },
        },
    });
}

/**
 * Determine if a GitHub login belongs to a configured team member.
 *
 * Uses the GITHUB_TEAM_LOGINS env var (comma-separated list of GitHub
 * usernames). Falls back to checking the database if the login is not
 * in the static list.
 */
export async function isTeamMember(login: string): Promise<boolean> {
    // Fast path: check the static team list
    if (config.teamLogins.includes(login)) {
        return true;
    }

    // Slow path: check the database for a linked team member
    const user = await prisma.user.findFirst({
        where: {
            externalId: login,
            source: { in: ['GITHUB_ISSUE', 'GITHUB_DISCUSSION'] },
        },
    });

    if (!user?.email) return false;

    const member = await prisma.teamMember.findUnique({
        where: { email: user.email },
    });

    return member !== null;
}
