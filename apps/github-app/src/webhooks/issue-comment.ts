import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';
import { truncate } from '@outpost/shared';
import { findTicketBySourceId, isTeamMember } from '../lib/tickets.js';

export async function handleIssueComment(
    event: EmitterWebhookEvent<'issue_comment.created'>,
): Promise<void> {
    const { comment, issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Comment on ${repository.full_name}#${issue.number} ` +
        `by ${sender.login}: ${comment.body.slice(0, 100)}`,
    );

    // Skip comments from bots
    if (sender.type === 'Bot') return;

    try {
        // Look up the ticket by GitHub issue number
        const ticket = await findTicketBySourceId(String(issue.number));
        if (!ticket) {
            // This issue isn't tracked as a ticket, ignore it
            return;
        }

        // Append the comment as a Message on the ticket
        await prisma.message.create({
            data: {
                ticketId: ticket.id,
                author: `${sender.login} (${sender.id})`,
                content: truncate(comment.body, 8000),
                type: 'USER',
            },
        });

        console.log(
            `[GitHub App] Comment from ${sender.login} appended to ticket ${ticket.displayId}`,
        );

        // Check if the commenter is a team member
        const teamMember = await isTeamMember(sender.login);

        if (teamMember) {
            // Team member message: don't enqueue AI response, but update
            // ticket status if it was waiting on the team
            if (ticket.status === 'WAITING_ON_TEAM') {
                await prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { status: 'WAITING_ON_CUSTOMER' },
                });
            }
        } else {
            // External user (likely original poster): enqueue AI response
            await createJob(JobType.AI_RESPONSE, {
                ticketId: ticket.id,
                source: 'github' as const,
            });

            // Reopen ticket if it was waiting on customer or resolved
            if (ticket.status === 'WAITING_ON_CUSTOMER' || ticket.status === 'RESOLVED') {
                await prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { status: 'OPEN' },
                });
            }
        }
    } catch (error) {
        console.error(
            `[GitHub App] Failed to process comment on ${repository.full_name}#${issue.number}:`,
            error,
        );
    }
}
