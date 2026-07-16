/**
 * Minimal GitHub App client for the worker process — read-only access
 * to comment reactions, used by the GITHUB_REACTION_POLL job.
 *
 * Deliberately separate from apps/github-app/src/lib/github-client.ts,
 * which lives in a different process and handles posting. This module
 * only needs reaction reads, and the worker process has no other
 * Octokit access today.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export interface GithubClientConfig {
    appId: string;
    privateKey: string;
    installationId: string;
}

/** Minimal interface for the one Octokit call this module needs. */
export interface GithubReactionClient {
    reactions: {
        listForIssueComment(params: {
            owner: string;
            repo: string;
            comment_id: number;
            per_page?: number;
        }): Promise<{ data: Array<{ content: string; user: { login: string } | null }> }>;
    };
}

export function createGithubClient(config: GithubClientConfig): GithubReactionClient {
    return new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: config.appId,
            privateKey: config.privateKey,
            installationId: config.installationId,
        },
    }) as unknown as GithubReactionClient;
}

export interface CommentReaction {
    content: string;
    login: string;
}

/**
 * List reactions on a GitHub issue comment. Only works for issue comments
 * (numeric REST comment IDs) — discussion-comment reactions are addressed
 * by GraphQL node_ids, not numeric REST IDs, and require the GraphQL API,
 * which is out of scope for this client.
 */
export async function listCommentReactions(
    client: GithubReactionClient,
    owner: string,
    repo: string,
    commentId: number,
): Promise<CommentReaction[]> {
    const response = await client.reactions.listForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        per_page: 100,
    });

    return response.data
        .filter((r) => r.user !== null)
        .map((r) => ({ content: r.content, login: r.user!.login }));
}
