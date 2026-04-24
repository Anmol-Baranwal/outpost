import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubPlatformAdapter } from '../platforms/github.js';
import type { GitHubOctokitLike } from '../platforms/github.js';
import { TicketSource } from '../types.js';

// ── Mock Octokit ──────────────────────────────────────────────────────────

function mockOctokit(): GitHubOctokitLike {
    return {
        issues: {
            createComment: vi.fn().mockResolvedValue({ data: { id: 12345 } }),
        },
        graphql: vi.fn().mockResolvedValue({
            addDiscussionComment: { comment: { id: 'comment-node-id' } },
        }),
    };
}

function makeTicket(overrides: Record<string, unknown> = {}): {
    id: string;
    sourceId: string | null;
    channel: string | null;
    source: TicketSource;
} {
    return {
        id: 'ticket-1',
        sourceId: 'CopilotKit/CopilotKit#42',
        channel: 'CopilotKit/CopilotKit',
        source: TicketSource.GITHUB_ISSUE,
        ...overrides,
    };
}

describe('GitHubPlatformAdapter', () => {
    let octokit: ReturnType<typeof mockOctokit>;
    let adapter: InstanceType<typeof GitHubPlatformAdapter>;

    beforeEach(() => {
        octokit = mockOctokit();
        adapter = new GitHubPlatformAdapter({ octokit });
    });

    // ── parseInboundEvent ────────────────────────────────────────────

    describe('parseInboundEvent', () => {
        it('parses issues.opened into a new InboundMessage', () => {
            const result = adapter.parseInboundEvent({
                action: 'opened',
                issue: {
                    number: 42,
                    title: 'Bug in CopilotKit',
                    body: 'It crashes on init',
                    html_url: 'https://github.com/CopilotKit/CopilotKit/issues/42',
                    node_id: 'I_kwDOAbc',
                },
                repository: { full_name: 'CopilotKit/CopilotKit' },
                sender: { login: 'user123', id: 999, type: 'User' },
            });

            expect(result).toEqual(expect.objectContaining({
                platformUserId: 'user123',
                platformUsername: 'user123',
                content: 'It crashes on init',
                threadId: 'CopilotKit/CopilotKit#42',
                channelId: 'CopilotKit/CopilotKit',
                source: TicketSource.GITHUB_ISSUE,
                isThreadStart: true,
            }));
        });

        it('parses issue_comment.created into a follow-up InboundMessage', () => {
            const result = adapter.parseInboundEvent({
                action: 'created',
                comment: { id: 100, body: 'Still broken' },
                issue: { number: 42, html_url: 'https://github.com/CopilotKit/CopilotKit/issues/42' },
                repository: { full_name: 'CopilotKit/CopilotKit' },
                sender: { login: 'user123', id: 999, type: 'User' },
            });

            expect(result).toEqual(expect.objectContaining({
                platformUserId: 'user123',
                content: 'Still broken',
                source: TicketSource.GITHUB_ISSUE,
                isThreadStart: false,
            }));
        });

        it('parses discussion.created into a new InboundMessage', () => {
            const result = adapter.parseInboundEvent({
                action: 'created',
                discussion: {
                    number: 7,
                    title: 'How do I do X?',
                    body: 'Help please',
                    html_url: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
                    node_id: 'D_kwDOAbc',
                },
                repository: { full_name: 'CopilotKit/CopilotKit' },
                sender: { login: 'asker', id: 888, type: 'User' },
            });

            expect(result).toEqual(expect.objectContaining({
                platformUserId: 'asker',
                content: 'Help please',
                source: TicketSource.GITHUB_DISCUSSION,
                isThreadStart: true,
                threadId: 'CopilotKit/CopilotKit#7',
                channelId: 'CopilotKit/CopilotKit',
            }));
        });

        it('parses discussion_comment.created into a follow-up InboundMessage', () => {
            const result = adapter.parseInboundEvent({
                action: 'created',
                comment: { id: 200, body: 'Me too', node_id: 'DC_kwDOxyz' },
                discussion: {
                    number: 7,
                    html_url: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
                    node_id: 'D_kwDOAbc',
                },
                repository: { full_name: 'CopilotKit/CopilotKit' },
                sender: { login: 'another', id: 111, type: 'User' },
            });

            expect(result).toEqual(expect.objectContaining({
                platformUserId: 'another',
                content: 'Me too',
                source: TicketSource.GITHUB_DISCUSSION,
                isThreadStart: false,
            }));
        });

        it('returns a minimal InboundMessage for unknown event types', () => {
            const result = adapter.parseInboundEvent({
                action: 'closed',
                issue: { number: 42 },
                repository: { full_name: 'CopilotKit/CopilotKit' },
            });
            // Unknown events still return an InboundMessage (not null)
            expect(result).toBeDefined();
            expect(result.content).toBe('');
        });

        it('handles issues with no body', () => {
            const result = adapter.parseInboundEvent({
                action: 'opened',
                issue: {
                    number: 43,
                    title: 'Empty issue',
                    body: null,
                    html_url: 'https://github.com/CopilotKit/CopilotKit/issues/43',
                },
                repository: { full_name: 'CopilotKit/CopilotKit' },
                sender: { login: 'user123', id: 999, type: 'User' },
            });

            expect(result).toBeDefined();
            expect(result.content).toBe('');
        });
    });

    // ── postResponse ─────────────────────────────────────────────────

    describe('postResponse', () => {
        it('posts a formatted response as an issue comment via REST', async () => {
            const ticket = makeTicket();
            await adapter.postResponse(ticket, { text: 'Here is the answer' });

            expect(octokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'CopilotKit',
                repo: 'CopilotKit',
                issue_number: 42,
                body: expect.stringContaining('Here is the answer'),
            });
        });

        it('includes feedback section in the response', async () => {
            const ticket = makeTicket();
            await adapter.postResponse(ticket, { text: 'Answer text' });

            const callArgs = vi.mocked(octokit.issues.createComment).mock.calls[0][0];
            expect(callArgs.body).toContain('Was this helpful?');
            expect(callArgs.body).toContain('\uD83D\uDC4D');
            expect(callArgs.body).toContain('\uD83D\uDC4E');
        });

        it('posts to discussions via GraphQL for GITHUB_DISCUSSION tickets', async () => {
            const ticket = makeTicket({
                source: TicketSource.GITHUB_DISCUSSION,
                sourceId: 'CopilotKit/CopilotKit#7',
                discussionNodeId: 'D_kwDOAbc',
            });

            // Mock graphql to return post result
            vi.mocked(octokit.graphql).mockResolvedValueOnce({
                addDiscussionComment: { comment: { id: 'new-comment' } },
            });

            await adapter.postResponse(ticket, { text: 'Answer' });

            expect(octokit.graphql).toHaveBeenCalledWith(
                expect.stringContaining('addDiscussionComment'),
                expect.objectContaining({
                    discussionId: 'D_kwDOAbc',
                    body: expect.stringContaining('Answer'),
                }),
            );
        });

        it('looks up discussion node_id when not in metadata', async () => {
            const ticket = makeTicket({
                source: TicketSource.GITHUB_DISCUSSION,
                sourceId: 'CopilotKit/CopilotKit#7',
            });

            // First graphql call: lookup
            vi.mocked(octokit.graphql)
                .mockResolvedValueOnce({
                    repository: { discussion: { id: 'D_looked_up' } },
                })
                // Second graphql call: post comment
                .mockResolvedValueOnce({
                    addDiscussionComment: { comment: { id: 'new-comment' } },
                });

            await adapter.postResponse(ticket, { text: 'Answer' });

            // Should have made a lookup query
            expect(octokit.graphql).toHaveBeenCalledWith(
                expect.stringContaining('GetDiscussionId'),
                expect.objectContaining({
                    owner: 'CopilotKit',
                    repo: 'CopilotKit',
                    number: 7,
                }),
            );

            // Should have posted with the looked-up ID
            expect(octokit.graphql).toHaveBeenCalledWith(
                expect.stringContaining('addDiscussionComment'),
                expect.objectContaining({
                    discussionId: 'D_looked_up',
                }),
            );
        });

        it('throws for invalid sourceId format', async () => {
            const ticket = makeTicket({ sourceId: 'bad-format' });
            await expect(adapter.postResponse(ticket, { text: 'Answer' }))
                .rejects.toThrow('Invalid GitHub sourceId');
        });

        it('throws when sourceId is null', async () => {
            const ticket = makeTicket({ sourceId: null });
            await expect(adapter.postResponse(ticket, { text: 'Answer' }))
                .rejects.toThrow('no sourceId');
        });
    });

    // ── postSystemMessage ────────────────────────────────────────────

    describe('postSystemMessage', () => {
        it('posts a plain message to an issue', async () => {
            const ticket = makeTicket();
            await adapter.postSystemMessage(ticket, 'Ticket created');

            expect(octokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'CopilotKit',
                repo: 'CopilotKit',
                issue_number: 42,
                body: 'Ticket created',
            });
        });

        it('does NOT include feedback section', async () => {
            const ticket = makeTicket();
            await adapter.postSystemMessage(ticket, 'Status update');

            const callArgs = vi.mocked(octokit.issues.createComment).mock.calls[0][0];
            expect(callArgs.body).not.toContain('Was this helpful?');
        });

        it('posts to discussions via GraphQL for GITHUB_DISCUSSION tickets', async () => {
            const ticket = makeTicket({
                source: TicketSource.GITHUB_DISCUSSION,
                sourceId: 'CopilotKit/CopilotKit#7',
                discussionNodeId: 'D_kwDOAbc',
            });

            vi.mocked(octokit.graphql).mockResolvedValueOnce({
                addDiscussionComment: { comment: { id: 'sys-comment' } },
            });

            await adapter.postSystemMessage(ticket, 'Ticket created');

            expect(octokit.graphql).toHaveBeenCalledWith(
                expect.stringContaining('addDiscussionComment'),
                expect.objectContaining({
                    discussionId: 'D_kwDOAbc',
                    body: 'Ticket created',
                }),
            );
        });
    });
});
