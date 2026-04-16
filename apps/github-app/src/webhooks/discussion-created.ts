import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@copilotkit/outpost-db';
import { createJob, JobType } from '@copilotkit/outpost-queue';
import { generateTicketId, truncate } from '@copilotkit/outpost-shared';
import { postDiscussionComment } from '../lib/github-client.js';

export async function handleDiscussionCreated(
    event: EmitterWebhookEvent<'discussion.created'>,
): Promise<void> {
    const { discussion, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Discussion created: ${repository.full_name} ` +
        `"${discussion.title}" by ${sender.login}`,
    );

    try {
        const displayId = generateTicketId();
        const discussionUrl = discussion.html_url;

        // Create the ticket in the database
        const ticket = await prisma.ticket.create({
            data: {
                displayId,
                title: truncate(discussion.title, 200),
                description: truncate(discussion.body ?? '', 4000),
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                source: 'GITHUB_DISCUSSION',
                sourceId: `${repository.full_name}#${discussion.number}`,
                sourceUrl: discussionUrl,
                channel: repository.full_name,
            },
        });

        // Create the first Message record from the discussion body
        if (discussion.body) {
            await prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    author: `${sender.login} (${sender.id})`,
                    content: truncate(discussion.body, 8000),
                    type: 'USER',
                },
            });
        }

        // Enqueue an AI response job
        await createJob(JobType.AI_RESPONSE, {
            ticketId: ticket.id,
            source: 'github' as const,
        });

        // Post acknowledgment comment on the discussion (uses GraphQL)
        await postDiscussionComment(
            discussion.node_id,
            `\uD83C\uDFAB Ticket ${displayId} created. Our AI assistant is reviewing your question...`,
        );

        console.log(
            `[GitHub App] Created ticket ${displayId} for discussion "${discussion.title}"`,
        );
    } catch (error) {
        console.error(
            `[GitHub App] Failed to create ticket for discussion "${discussion.title}":`,
            error,
        );
    }
}
