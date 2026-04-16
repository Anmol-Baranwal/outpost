import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@outpost/db';
import { createJob, JobType } from '@outpost/queue';
import { generateTicketId, truncate } from '@outpost/shared';
import { postIssueComment } from '../lib/github-client.js';

export async function handleIssueOpened(
    event: EmitterWebhookEvent<'issues.opened'>,
): Promise<void> {
    const { issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Issue opened: ${repository.full_name}#${issue.number} ` +
        `"${issue.title}" by ${sender.login}`,
    );

    try {
        const displayId = generateTicketId();
        const issueUrl = issue.html_url;

        // Create the ticket in the database
        const ticket = await prisma.ticket.create({
            data: {
                displayId,
                title: truncate(issue.title, 200),
                description: truncate(issue.body ?? '', 4000),
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                source: 'GITHUB_ISSUE',
                sourceId: `${repository.full_name}#${issue.number}`,
                sourceUrl: issueUrl,
                channel: repository.full_name,
            },
        });

        // Create the first Message record from the issue body
        if (issue.body) {
            await prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    author: `${sender.login} (${sender.id})`,
                    content: truncate(issue.body, 8000),
                    type: 'USER',
                },
            });
        }

        // Enqueue an AI response job
        await createJob(JobType.AI_RESPONSE, {
            ticketId: ticket.id,
            source: 'github' as const,
        });

        // Post acknowledgment comment on the issue
        const [owner, repo] = repository.full_name.split('/');
        await postIssueComment(
            owner,
            repo,
            issue.number,
            `\uD83C\uDFAB Ticket ${displayId} created. Our AI assistant is reviewing your issue...`,
        );

        console.log(
            `[GitHub App] Created ticket ${displayId} for issue ${repository.full_name}#${issue.number}`,
        );
    } catch (error) {
        console.error(
            `[GitHub App] Failed to create ticket for issue ${repository.full_name}#${issue.number}:`,
            error,
        );
    }
}
