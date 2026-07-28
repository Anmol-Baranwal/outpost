import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { InboundHandler, GitHubPlatformAdapter } from '@copilotkit/outpost/shared/platforms';
import type { InboundPrismaLike, CreateJobFn } from '@copilotkit/outpost/shared';
import { getOctokit } from '../lib/github-client.js';
import { isRepoAllowed } from '../lib/repo-allowlist.js';
import { config } from '../config.js';

export async function handleIssueOpened(
    event: EmitterWebhookEvent<'issues.opened'>,
): Promise<void> {
    const { issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Issue opened: ${repository.full_name}#${issue.number} ` +
        `"${issue.title}" by ${sender.login}`,
    );

    if (!isRepoAllowed(repository.full_name, config.allowedRepos)) {
        console.log(
            `[GitHub App] Ignoring issue on non-allowlisted repo ${repository.full_name}`,
        );
        return;
    }

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

        // Intentionally no "Ticket TKT-\u2026 created" acknowledgment comment. The
        // ticket id is internal, and the AI response lands in the same thread
        // moments later \u2014 the ack was pure noise on a public issue.

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
