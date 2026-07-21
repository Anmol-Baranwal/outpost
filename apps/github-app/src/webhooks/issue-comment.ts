import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { GitHubPlatformAdapter } from '@copilotkit/outpost/shared/platforms';
import { getOctokit } from '../lib/github-client.js';
import { findTicketBySourceId, isTeamMember } from '../lib/tickets.js';
import { isRepoAllowed } from '../lib/repo-allowlist.js';
import { config } from '../config.js';

export async function handleIssueComment(
    event: EmitterWebhookEvent<'issue_comment.created'>,
): Promise<void> {
    const { comment, issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Comment on ${repository.full_name}#${issue.number} ` +
        `by ${sender.login}: ${(comment.body ?? '').slice(0, 100)}`,
    );

    if (!isRepoAllowed(repository.full_name, config.allowedRepos)) {
        console.log(
            `[GitHub App] Ignoring comment on non-allowlisted repo ${repository.full_name}`,
        );
        return;
    }

    // Skip comments from bots
    if (sender.type === 'Bot') return;

    try {
        // Look up the ticket by composite sourceId (owner/repo#number)
        const ticket = await findTicketBySourceId(`${repository.full_name}#${issue.number}`);
        if (!ticket) {
            // This issue isn't tracked as a ticket, ignore it
            return;
        }

        const adapter = new GitHubPlatformAdapter({ octokit: getOctokit() });
        const message = adapter.parseInboundEvent({
            action: 'created',
            comment: event.payload.comment,
            issue: event.payload.issue,
            repository: event.payload.repository,
            sender: event.payload.sender,
        });

        if (!message) {
            console.error('[GitHub App] Failed to parse issue_comment.created event');
            return;
        }

        // Append the comment as a Message on the ticket
        const commentBody = message.content || comment.body;
        await prisma.message.create({
            data: {
                ticketId: ticket.id,
                author: `${sender.login} (${sender.id})`,
                content: commentBody.length > 8000 ? commentBody.slice(0, 7997) + '...' : commentBody,
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
            await createJob('AI_RESPONSE' as Parameters<typeof createJob>[0], {
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
