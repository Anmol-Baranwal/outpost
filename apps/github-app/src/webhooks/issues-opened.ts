import type { EmitterWebhookEvent } from '@octokit/webhooks';

export async function handleIssueOpened(
    event: EmitterWebhookEvent<'issues.opened'>,
): Promise<void> {
    const { issue, repository, sender } = event.payload;

    console.log(
        `[GitHub App] Issue opened: ${repository.full_name}#${issue.number} ` +
        `"${issue.title}" by ${sender.login}`,
    );

    // TODO: Implement issue processing
    // 1. Create or find the user by GitHub username
    // 2. Look up account by repository/org
    // 3. Create a new ticket with source=GITHUB_ISSUE
    // 4. Queue AI analysis for auto-categorization
    // 5. Queue notification to relevant channel
}
