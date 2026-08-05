/**
 * GitHub platform adapter for inbound webhook parsing and outbound
 * response/message posting.
 *
 * Handles:
 *   - Parsing issues.opened, issue_comment.created, discussion.created,
 *     discussion_comment.created into InboundMessage
 *   - Posting AI responses (with confidence disclaimers + feedback)
 *   - Posting system messages (acknowledgments, status updates)
 *   - Routing between REST (issues) and GraphQL (discussions)
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { TicketSource } from '../types.js';
import type {
    PlatformAdapter,
    InboundMessage,
    PlatformUser,
    FormattedResponse,
    TicketRef,
} from './types.js';

// ─── Octokit-like interfaces ──────────────────────────────────────────────

/**
 * Minimal Octokit-compatible interface for REST + GraphQL calls.
 * The real Octokit instance is injected at runtime.
 */
export interface GitHubOctokitLike {
    issues: {
        createComment(params: {
            owner: string;
            repo: string;
            issue_number: number;
            body: string;
        }): Promise<{ data: { id: number } }>;
    };
    graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

// ─── Config ───────────────────────────────────────────────────────────────

export interface GitHubAdapterConfig {
    /** Pre-authenticated Octokit instance for API calls (if provided directly) */
    octokit?: GitHubOctokitLike;
    /** GitHub App ID */
    appId?: string;
    /** GitHub App private key (PEM) */
    privateKey?: string;
    /** GitHub App installation ID */
    installationId?: number;
}

/** Legacy alias */
export type GitHubPlatformAdapterConfig = GitHubAdapterConfig;

// ─── Adapter ──────────────────────────────────────────────────────────────

export class GitHubAdapter implements PlatformAdapter {
    readonly platform = TicketSource.GITHUB_ISSUE;

    private octokit: GitHubOctokitLike | null;
    private config: GitHubAdapterConfig;

    constructor(config: GitHubAdapterConfig) {
        this.config = config;
        this.octokit = config.octokit ?? null;
    }

    private getOctokit(): GitHubOctokitLike {
        if (this.octokit) {
            return this.octokit;
        }

        // No instance injected — build an App-authenticated Octokit from the
        // configured credentials. This is the path the shared registry uses
        // (e.g. the worker posting AI responses back to GitHub); apps/github-app
        // injects its own Octokit and never reaches here.
        const { appId, privateKey, installationId } = this.config;
        if (appId && privateKey && installationId) {
            this.octokit = new Octokit({
                authStrategy: createAppAuth,
                auth: { appId, privateKey, installationId },
            }) as unknown as GitHubOctokitLike;
            return this.octokit;
        }

        throw new Error(
            `[GitHubAdapter] No Octokit instance available and incomplete App credentials. ` +
                `Present: appId=${!!appId}, privateKey=${!!privateKey}, installationId=${!!installationId}. ` +
                `Provide an Octokit instance or all of GITHUB_APP_ID / GITHUB_PRIVATE_KEY / GITHUB_INSTALLATION_ID.`,
        );
    }

    // ── Inbound Parsing ──────────────────────────────────────────────

    parseInboundEvent(rawEvent: unknown): InboundMessage {
        const event = rawEvent as Record<string, unknown>;
        const action = event.action as string | undefined;

        // Determine event type from action + payload shape
        if (action === 'opened' && event.issue) {
            return this.parseIssueOpened(event);
        }
        if (action === 'created' && event.comment && event.issue) {
            return this.parseIssueComment(event);
        }
        if (action === 'created' && event.discussion && !event.comment) {
            return this.parseDiscussionCreated(event);
        }
        if (action === 'created' && event.comment && event.discussion) {
            return this.parseDiscussionComment(event);
        }

        // For typed event objects from the old interface
        const eventType = event.type as string | undefined;
        const payload = event.payload as Record<string, unknown> | undefined;
        if (eventType && payload) {
            switch (eventType) {
                case 'issues.opened':
                    return this.parseIssueOpened(payload);
                case 'issue_comment.created':
                    return this.parseIssueComment(payload);
                case 'discussion.created':
                    return this.parseDiscussionCreated(payload);
                case 'discussion_comment.created':
                    return this.parseDiscussionComment(payload);
            }
        }

        // Return a minimal InboundMessage for unrecognized events
        // (callers can filter based on content)
        return {
            platformUserId: '',
            platformUsername: '',
            content: '',
            source: TicketSource.GITHUB_ISSUE,
            isThreadStart: false,
            rawEvent,
        };
    }

    private parseIssueOpened(payload: Record<string, unknown>): InboundMessage {
        const issue = payload.issue as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        const sender = payload.sender as Record<string, unknown> | undefined;

        const fullName = (repository?.full_name as string) ?? '';
        const number = (issue?.number as number) ?? 0;
        const login = (sender?.login as string) ?? '';
        const body = (issue?.body as string) ?? '';

        return {
            platformUserId: login,
            platformUsername: login,
            content: body,
            threadId: `${fullName}#${number}`,
            channelId: fullName,
            sourceUrl: (issue?.html_url as string) ?? undefined,
            source: TicketSource.GITHUB_ISSUE,
            isThreadStart: true,
            rawEvent: payload,
        };
    }

    private parseIssueComment(payload: Record<string, unknown>): InboundMessage {
        const comment = payload.comment as Record<string, unknown> | undefined;
        const issue = payload.issue as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        const sender = payload.sender as Record<string, unknown> | undefined;

        const fullName = (repository?.full_name as string) ?? '';
        const number = (issue?.number as number) ?? 0;
        const login = (sender?.login as string) ?? '';

        return {
            platformUserId: login,
            platformUsername: login,
            content: (comment?.body as string) ?? '',
            threadId: `${fullName}#${number}`,
            channelId: fullName,
            sourceUrl: (comment?.html_url as string) ?? (issue?.html_url as string) ?? undefined,
            source: TicketSource.GITHUB_ISSUE,
            isThreadStart: false,
            rawEvent: payload,
        };
    }

    private parseDiscussionCreated(payload: Record<string, unknown>): InboundMessage {
        const discussion = payload.discussion as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        const sender = payload.sender as Record<string, unknown> | undefined;

        const fullName = (repository?.full_name as string) ?? '';
        const number = (discussion?.number as number) ?? 0;
        const login = (sender?.login as string) ?? '';

        return {
            platformUserId: login,
            platformUsername: login,
            content: (discussion?.body as string) ?? '',
            threadId: `${fullName}#${number}`,
            channelId: fullName,
            sourceUrl: (discussion?.html_url as string) ?? undefined,
            source: TicketSource.GITHUB_DISCUSSION,
            isThreadStart: true,
            rawEvent: payload,
        };
    }

    private parseDiscussionComment(payload: Record<string, unknown>): InboundMessage {
        const comment = payload.comment as Record<string, unknown> | undefined;
        const discussion = payload.discussion as Record<string, unknown> | undefined;
        const repository = payload.repository as Record<string, unknown> | undefined;
        const sender = payload.sender as Record<string, unknown> | undefined;

        const fullName = (repository?.full_name as string) ?? '';
        const number = (discussion?.number as number) ?? 0;
        const login = (sender?.login as string) ?? '';

        return {
            platformUserId: login,
            platformUsername: login,
            content: (comment?.body as string) ?? '',
            threadId: `${fullName}#${number}`,
            channelId: fullName,
            sourceUrl:
                (comment?.html_url as string) ?? (discussion?.html_url as string) ?? undefined,
            source: TicketSource.GITHUB_DISCUSSION,
            isThreadStart: false,
            rawEvent: payload,
        };
    }

    // ── fetchUserInfo ───────────────────────────────────────────────────

    async fetchUserInfo(platformUserId: string): Promise<PlatformUser> {
        // GitHub user info would be fetched via Octokit REST API
        // For now, return minimal info from the login
        return {
            platformId: platformUserId,
            username: platformUserId,
        };
    }

    // ── Outbound Posting ─────────────────────────────────────────────

    /**
     * Post an AI-generated response to GitHub.
     *
     * - Adds a feedback section ("Was this helpful? ...")
     * - Routes to REST (issues) or GraphQL (discussions) based on ticket source
     */
    async postResponse(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        response: FormattedResponse,
    ): Promise<string | undefined> {
        if (!ticket.sourceId) {
            throw new Error(`Cannot post GitHub response — ticket ${ticket.id} has no sourceId`);
        }

        let body = response.text;
        body += '\n\n---\nWas this helpful? React with \uD83D\uDC4D or \uD83D\uDC4E';

        return this.postComment(ticket, body);
    }

    /**
     * Post a system message (acknowledgment, status update) to GitHub.
     * No feedback section or confidence disclaimer.
     */
    async postSystemMessage(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        message: string,
    ): Promise<void> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post GitHub system message — ticket ${ticket.id} has no sourceId`,
            );
        }

        await this.postComment(ticket, message);
    }

    // ── Internal Routing ─────────────────────────────────────────────

    /**
     * Post a comment to the correct GitHub endpoint based on ticket source.
     */
    private async postComment(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        body: string,
    ): Promise<string | undefined> {
        if (ticket.source === TicketSource.GITHUB_DISCUSSION) {
            return this.postDiscussionComment(ticket, body);
        }
        return this.postIssueComment(ticket, body);
    }

    /**
     * Post a comment on a GitHub issue via REST API.
     */
    private async postIssueComment(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        body: string,
    ): Promise<string | undefined> {
        const parsed = parseSourceId(ticket.sourceId!);
        if (!parsed) {
            throw new Error(`Invalid GitHub sourceId: ${ticket.sourceId}`);
        }

        const octokit = this.getOctokit();
        const result = await octokit.issues.createComment({
            owner: parsed.owner,
            repo: parsed.repo,
            issue_number: parsed.number,
            body,
        });
        return String(result.data.id);
    }

    /**
     * Post a comment on a GitHub discussion via GraphQL API.
     *
     * Uses the node_id stored in ticket metadata, or falls back to
     * looking it up from the sourceId.
     */
    private async postDiscussionComment(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        body: string,
    ): Promise<string | undefined> {
        const octokit = this.getOctokit();

        // Try to get the discussion node_id from the ticket
        let nodeId = (ticket as Record<string, unknown>).discussionNodeId as string | undefined;

        if (!nodeId) {
            // Look up the discussion node_id via GraphQL
            const parsed = parseSourceId(ticket.sourceId!);
            if (!parsed) {
                throw new Error(`Invalid GitHub sourceId: ${ticket.sourceId}`);
            }

            const result = await octokit.graphql<{
                repository: { discussion: { id: string } };
            }>(
                `query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        discussion(number: $number) {
                            id
                        }
                    }
                }`,
                {
                    owner: parsed.owner,
                    repo: parsed.repo,
                    number: parsed.number,
                },
            );

            nodeId = result.repository.discussion.id;
        }

        const result = await octokit.graphql<{
            addDiscussionComment: { comment: { id: string } };
        }>(
            `mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
                addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
                    comment {
                        id
                    }
                }
            }`,
            {
                discussionId: nodeId,
                body,
            },
        );

        return result.addDiscussionComment.comment.id;
    }
}

/** Legacy alias for backward compatibility */
export const GitHubPlatformAdapter = GitHubAdapter;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Parse "owner/repo#number" into its components.
 */
function parseSourceId(sourceId: string): { owner: string; repo: string; number: number } | null {
    const match = sourceId.match(/^(.+?)\/(.+?)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}
