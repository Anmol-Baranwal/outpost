import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { config } from '../config.js';

let _octokit: Octokit | null = null;

/**
 * Get an Octokit instance authenticated as the GitHub App installation.
 *
 * Uses JWT authentication with the app's private key and then requests
 * an installation access token scoped to the configured installation.
 */
export function getOctokit(): Octokit {
    if (_octokit) return _octokit;

    _octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: config.appId,
            privateKey: config.privateKey,
            installationId: config.installationId,
        },
    });

    return _octokit;
}

/**
 * Reset the cached Octokit instance (useful for testing).
 */
export function resetOctokit(): void {
    _octokit = null;
}

/**
 * Post a comment on a GitHub issue.
 */
export async function postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
): Promise<number> {
    const octokit = getOctokit();
    const response = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
    });
    return response.data.id;
}

/**
 * Get a GitHub issue by number.
 */
export async function getIssue(
    owner: string,
    repo: string,
    issueNumber: number,
) {
    const octokit = getOctokit();
    const response = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
    });
    return response.data;
}

/**
 * List comments on a GitHub issue.
 */
export async function listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
) {
    const octokit = getOctokit();
    const response = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
    });
    return response.data;
}

/**
 * Post a comment on a GitHub discussion using the GraphQL API.
 *
 * The REST API does not support discussion comments, so we use
 * the GraphQL mutations endpoint instead.
 */
export async function postDiscussionComment(
    discussionNodeId: string,
    body: string,
): Promise<string> {
    const octokit = getOctokit();
    const mutation = `
        mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
            addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
                comment {
                    id
                }
            }
        }
    `;

    const result = await octokit.graphql<{
        addDiscussionComment: { comment: { id: string } };
    }>(mutation, {
        discussionId: discussionNodeId,
        body,
    });

    return result.addDiscussionComment.comment.id;
}
