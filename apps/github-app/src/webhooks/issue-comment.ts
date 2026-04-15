import type { EmitterWebhookEvent } from '@octokit/webhooks';

export async function handleIssueComment(
    event: EmitterWebhookEvent<'issue_comment.created'>,
): Promise<void> {
    const { comment, issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Comment on ${repository.full_name}#${issue.number} ` +
        `by ${sender.login}: ${comment.body.slice(0, 100)}`,
    );

    // TODO: Implement comment processing
    // 1. Find existing ticket for this issue
    // 2. Add message to ticket thread
    // 3. If from external user, queue AI response generation
    // 4. Update ticket status if needed (e.g., WAITING_ON_CUSTOMER -> OPEN)
}
