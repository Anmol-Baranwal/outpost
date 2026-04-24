import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { InboundHandler, GitHubPlatformAdapter } from '@copilotkit/outpost/shared';
import type { InboundPrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import { getOctokit } from '../lib/github-client.js';

export async function handleIssueOpened(
    event: EmitterWebhookEvent<'issues.opened'>,
): Promise<void> {
    const { issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Issue opened: ${repository.full_name}#${issue.number} ` +
        `"${issue.title}" by ${sender.login}`,
    );

    try {
        const adapter = new GitHubPlatformAdapter({ octokit: getOctokit() });
        const message = adapter.parseInboundEvent({
            action: 'opened',
            issue: event.payload.issue,
            repository: event.payload.repository,
            sender: event.payload.sender,
        });

        if (!message) {
            console.error('[GitHub App] Failed to parse issues.opened event');
            return;
        }
        if (!message.content) {
            message.content = (issue.body as string) ?? '';
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
                externalId: `${repository.full_name}#${issue.number}`,
                externalUrl: issue.html_url,
            },
        });

        // Post acknowledgment comment on the issue
        const ticketRef = {
            id: result.ticketId,
            sourceId: `${repository.full_name}#${issue.number}`,
            channel: repository.full_name,
            source: 'GITHUB_ISSUE' as const,
        };
        await adapter.postSystemMessage(
            ticketRef as Parameters<typeof adapter.postSystemMessage>[0],
            `\uD83C\uDFAB Ticket ${result.displayId} created. Our AI assistant is reviewing your issue...`,
        );

        console.log(
            `[GitHub App] Created ticket ${result.displayId} for issue ${repository.full_name}#${issue.number}`,
        );
    } catch (error) {
        console.error(
            `[GitHub App] Failed to create ticket for issue ${repository.full_name}#${issue.number}:`,
            error,
        );
    }
}
