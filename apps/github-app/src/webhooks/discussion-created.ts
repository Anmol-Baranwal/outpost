import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { InboundHandler, GitHubPlatformAdapter } from '@copilotkit/outpost/shared/platforms';
import type { InboundPrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import { getOctokit } from '../lib/github-client.js';

export async function handleDiscussionCreated(
    event: EmitterWebhookEvent<'discussion.created'>,
): Promise<void> {
    const { discussion, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Discussion created: ${repository.full_name} ` +
        `"${discussion.title}" by ${sender.login}`,
    );

    try {
        const adapter = new GitHubPlatformAdapter({ octokit: getOctokit() });
        const message = adapter.parseInboundEvent({
            action: 'created',
            discussion: event.payload.discussion,
            repository: event.payload.repository,
            sender: event.payload.sender,
        });

        if (!message) {
            console.error('[GitHub App] Failed to parse discussion.created event');
            return;
        }
        if (!message.content) {
            message.content = (discussion.body as string) ?? '';
        }

        const handler = new InboundHandler({
            prisma: prisma as unknown as InboundPrismaLike,
            createJob: createJob as unknown as CreateJobFn,
        });
        const result = await handler.handle(message);

        // GitHub-specific: create TicketExternalLink for bidirectional sync
        await prisma.ticketExternalLink.create({
            data: {
                ticketId: result.ticketId,
                plugin: 'github',
                externalId: `${repository.full_name}#${discussion.number}`,
                externalUrl: discussion.html_url,
            },
        });

        // Post acknowledgment comment on the discussion
        // Store the discussion node_id on the ticket ref for routing
        const ticketRef = {
            id: result.ticketId,
            sourceId: `${repository.full_name}#${discussion.number}`,
            channel: repository.full_name,
            source: 'GITHUB_DISCUSSION' as const,
            discussionNodeId: discussion.node_id,
        };
        await adapter.postSystemMessage(
            ticketRef as Parameters<typeof adapter.postSystemMessage>[0],
            `\uD83C\uDFAB Ticket ${result.displayId} created. Our AI assistant is reviewing your question...`,
        );

        console.log(
            `[GitHub App] Created ticket ${result.displayId} for discussion "${discussion.title}"`,
        );
    } catch (error) {
        console.error(
            `[GitHub App] Failed to create ticket for discussion "${discussion.title}":`,
            error,
        );
    }
}
