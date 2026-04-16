/**
 * Onboarding digest job handler.
 *
 * Consumes ONBOARDING_DIGEST jobs from the queue, queries new members
 * from the last 24 hours, and compiles a formatted digest.
 *
 * For now the digest is logged. Later it will post to a Discord channel
 * or DM Nathan directly.
 */

import { prisma } from '@copilotkit/outpost-db';
import { computeFunnelMetrics } from '@copilotkit/outpost-shared';
import type { OnboardingMember } from '@copilotkit/outpost-shared';
import type { OnboardingDigestPayload, JobResult, JobHandlerContext } from '../types.js';

/**
 * Handle an ONBOARDING_DIGEST job.
 *
 * 1. Parse the target date from the payload
 * 2. Query members who joined in the last 24 hours
 * 3. Compile and log a formatted digest
 */
export async function handleOnboardingDigest(
    payload: OnboardingDigestPayload,
    context: JobHandlerContext,
): Promise<JobResult> {
    const targetDate = payload.date || new Date().toISOString().split('T')[0];

    await context.reportProgress(10);

    // Query new members from the last 24 hours
    const since = new Date(targetDate);
    since.setHours(0, 0, 0, 0);

    const until = new Date(since);
    until.setDate(until.getDate() + 1);

    const newMembers = await prisma.onboardingMember.findMany({
        where: {
            joinedAt: {
                gte: since,
                lt: until,
            },
        },
        orderBy: { joinedAt: 'asc' },
    });

    await context.reportProgress(50);

    // Compile the digest
    const digestLines = [
        `===== Onboarding Digest for ${targetDate} =====`,
        `New members: ${newMembers.length}`,
        '',
    ];

    if (newMembers.length === 0) {
        digestLines.push('No new members joined today.');
    } else {
        digestLines.push('Member List:');
        for (const member of newMembers) {
            const joinTime = new Date(member.joinedAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });
            digestLines.push(`  - ${member.username} (joined at ${joinTime})`);
        }
    }

    await context.reportProgress(70);

    // Compute overall funnel metrics
    const allMembers = await prisma.onboardingMember.findMany();
    const metrics = computeFunnelMetrics(allMembers as unknown as OnboardingMember[]);

    digestLines.push('');
    digestLines.push('Funnel Summary (all time):');
    digestLines.push(`  Joined: ${metrics.stageCounts.JOINED}`);
    digestLines.push(`  Contacted: ${metrics.stageCounts.CONTACTED} (${metrics.conversionRates.joinedToContacted}%)`);
    digestLines.push(`  Responded: ${metrics.stageCounts.RESPONDED} (${metrics.conversionRates.contactedToResponded}%)`);
    digestLines.push(`  Meeting Booked: ${metrics.stageCounts.MEETING_BOOKED} (${metrics.conversionRates.respondedToMeetingBooked}%)`);

    const digest = digestLines.join('\n');

    await context.reportProgress(90);

    // For now, log the digest. Later: post to Discord channel or DM Nathan.
    console.log(`[Onboarding Digest]\n${digest}`);

    await context.reportProgress(100);

    return {
        success: true,
        data: {
            date: targetDate,
            newMemberCount: newMembers.length,
            totalMembers: metrics.totalMembers,
        },
    };
}
