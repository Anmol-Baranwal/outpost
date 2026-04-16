import type { GuildMember } from 'discord.js';
import { prisma } from '@copilotkit/outpost-db';

/**
 * Handle a new member joining the Discord guild.
 *
 * Records them in the OnboardingMember table so the daily digest
 * can pick them up and Nathan can track the greeting funnel.
 */
export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
    // Ignore bots
    if (member.user.bot) return;

    try {
        await prisma.onboardingMember.upsert({
            where: { discordId: member.id },
            update: {
                username: member.user.tag,
            },
            create: {
                discordId: member.id,
                username: member.user.tag,
                joinedAt: member.joinedAt ?? new Date(),
                funnelStage: 'JOINED',
                contacted: false,
                responded: false,
                meetingBooked: false,
            },
        });

        console.log(
            `[Discord Bot] New member recorded: ${member.user.tag} (${member.id})`,
        );
    } catch (error) {
        console.error(
            `[Discord Bot] Failed to record new member ${member.user.tag}:`,
            error,
        );
    }
}
