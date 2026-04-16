/**
 * GitHub ExternalTracker adapter.
 *
 * Translates between GitHub issue/discussion webhooks and the Outpost
 * sync engine's TicketChange format.  Push operations use Octokit to
 * modify issues on GitHub.
 */

import { TicketStatus } from '../../types.js';
import type {
    ExternalTracker,
    WebhookEvent,
    TicketChange,
    TicketExternalLinkRef,
} from '../types.js';

/**
 * Minimal Octokit-compatible interface so this adapter lives in the
 * shared package without depending on @octokit/rest at compile time.
 * The real Octokit instance is injected at runtime by the GitHub App.
 */
export interface OctokitLike {
    issues: {
        update(params: { owner: string; repo: string; issue_number: number; state: string }): Promise<unknown>;
        createComment(params: { owner: string; repo: string; issue_number: number; body: string }): Promise<unknown>;
        setLabels(params: { owner: string; repo: string; issue_number: number; labels: string[] }): Promise<unknown>;
    };
}

export interface GitHubAdapterConfig {
    /** Pre-authenticated Octokit instance for API calls */
    octokit: OctokitLike;
}

/**
 * Parse "owner/repo#number" into its components.
 * Returns null if the format is invalid.
 */
function parseExternalId(externalId: string): { owner: string; repo: string; number: number } | null {
    const match = externalId.match(/^(.+?)\/(.+?)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export class GitHubAdapter implements ExternalTracker {
    readonly name = 'github';

    private octokit: OctokitLike;

    constructor(config: GitHubAdapterConfig) {
        this.octokit = config.octokit;
    }

    // ── Webhook Parsing ───────────────────────────────────────────────

    async onWebhookReceived(event: WebhookEvent): Promise<TicketChange | null> {
        if (event.plugin !== 'github') return null;

        switch (event.eventType) {
            case 'issues.opened':
                return this.parseIssueOpened(event.payload);
            case 'issues.closed':
                return this.parseIssueClosed(event.payload);
            case 'issues.reopened':
                return this.parseIssueReopened(event.payload);
            case 'issue_comment.created':
                return this.parseIssueComment(event.payload);
            case 'discussion.created':
                return this.parseDiscussionCreated(event.payload);
            default:
                return null;
        }
    }

    private parseIssueOpened(payload: Record<string, unknown>): TicketChange | null {
        const issue = payload.issue as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        if (!issue || !repository) return null;

        const fullName = repository.full_name as string;
        const number = issue.number as number;

        return {
            externalId: `${fullName}#${number}`,
            action: 'new_issue',
            status: TicketStatus.OPEN,
            title: issue.title as string,
            description: (issue.body as string) ?? '',
            metadata: {
                htmlUrl: issue.html_url as string,
                senderLogin: (payload.sender as Record<string, unknown>)?.login,
            },
        };
    }

    private parseIssueClosed(payload: Record<string, unknown>): TicketChange | null {
        const issue = payload.issue as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        if (!issue || !repository) return null;

        const fullName = repository.full_name as string;
        const number = issue.number as number;

        return {
            externalId: `${fullName}#${number}`,
            action: 'status_change',
            status: TicketStatus.CLOSED,
        };
    }

    private parseIssueReopened(payload: Record<string, unknown>): TicketChange | null {
        const issue = payload.issue as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        if (!issue || !repository) return null;

        const fullName = repository.full_name as string;
        const number = issue.number as number;

        return {
            externalId: `${fullName}#${number}`,
            action: 'status_change',
            status: TicketStatus.OPEN,
        };
    }

    private parseIssueComment(payload: Record<string, unknown>): TicketChange | null {
        const comment = payload.comment as Record<string, unknown> | undefined;
        const issue = payload.issue as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        if (!comment || !issue || !repository) return null;

        const fullName = repository.full_name as string;
        const number = issue.number as number;

        return {
            externalId: `${fullName}#${number}`,
            action: 'comment',
            comment: comment.body as string,
            metadata: {
                commentId: comment.id,
                senderLogin: (payload.sender as Record<string, unknown>)?.login,
            },
        };
    }

    private parseDiscussionCreated(payload: Record<string, unknown>): TicketChange | null {
        const discussion = payload.discussion as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        if (!discussion || !repository) return null;

        const fullName = repository.full_name as string;
        const number = discussion.number as number;

        return {
            externalId: `${fullName}#${number}`,
            action: 'new_issue',
            status: TicketStatus.OPEN,
            title: discussion.title as string,
            description: (discussion.body as string) ?? '',
            metadata: {
                htmlUrl: discussion.html_url as string,
                nodeId: discussion.node_id,
                senderLogin: (payload.sender as Record<string, unknown>)?.login,
            },
        };
    }

    // ── Push Operations ───────────────────────────────────────────────

    async pushStatusChange(link: TicketExternalLinkRef, status: TicketStatus): Promise<void> {
        const parsed = parseExternalId(link.externalId);
        if (!parsed) {
            throw new Error(`Invalid GitHub external ID: ${link.externalId}`);
        }

        const state = this.mapStatusFromOutpost(status) as 'open' | 'closed';
        await this.octokit.issues.update({
            owner: parsed.owner,
            repo: parsed.repo,
            issue_number: parsed.number,
            state,
        });
    }

    async pushComment(link: TicketExternalLinkRef, message: string): Promise<void> {
        const parsed = parseExternalId(link.externalId);
        if (!parsed) {
            throw new Error(`Invalid GitHub external ID: ${link.externalId}`);
        }

        await this.octokit.issues.createComment({
            owner: parsed.owner,
            repo: parsed.repo,
            issue_number: parsed.number,
            body: message,
        });
    }

    async pushLabels(link: TicketExternalLinkRef, labels: string[]): Promise<void> {
        const parsed = parseExternalId(link.externalId);
        if (!parsed) {
            throw new Error(`Invalid GitHub external ID: ${link.externalId}`);
        }

        await this.octokit.issues.setLabels({
            owner: parsed.owner,
            repo: parsed.repo,
            issue_number: parsed.number,
            labels,
        });
    }

    // ── Status Mapping ────────────────────────────────────────────────

    mapStatusToOutpost(externalStatus: string): TicketStatus {
        switch (externalStatus) {
            case 'open':
                return TicketStatus.OPEN;
            case 'closed':
                return TicketStatus.CLOSED;
            default:
                return TicketStatus.OPEN;
        }
    }

    mapStatusFromOutpost(status: TicketStatus): string {
        switch (status) {
            case TicketStatus.CLOSED:
            case TicketStatus.RESOLVED:
                return 'closed';
            case TicketStatus.OPEN:
            case TicketStatus.IN_PROGRESS:
            case TicketStatus.WAITING_ON_CUSTOMER:
            case TicketStatus.WAITING_ON_TEAM:
            default:
                return 'open';
        }
    }
}
