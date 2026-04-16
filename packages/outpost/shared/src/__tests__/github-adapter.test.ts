import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAdapter } from '../sync/adapters/github.js';
import { TicketStatus } from '../types.js';
import type { WebhookEvent, TicketExternalLinkRef } from '../sync/types.js';

// ── Mock Octokit ──────────────────────────────────────────────────────────

function mockOctokit() {
    return {
        issues: {
            update: vi.fn().mockResolvedValue({}),
            createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
            setLabels: vi.fn().mockResolvedValue({}),
        },
    };
}

function makeLink(overrides: Partial<TicketExternalLinkRef> = {}): TicketExternalLinkRef {
    return {
        id: 'link-1',
        ticketId: 'ticket-1',
        plugin: 'github',
        externalId: 'CopilotKit/CopilotKit#42',
        externalUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
        ...overrides,
    };
}

describe('GitHubAdapter', () => {
    let octokit: ReturnType<typeof mockOctokit>;
    let adapter: GitHubAdapter;

    beforeEach(() => {
        octokit = mockOctokit();
        adapter = new GitHubAdapter({ octokit: octokit as never });
    });

    // ── Name ──────────────────────────────────────────────────────────

    it('has name "github"', () => {
        expect(adapter.name).toBe('github');
    });

    // ── onWebhookReceived ─────────────────────────────────────────────

    describe('onWebhookReceived', () => {
        it('returns null for non-github plugins', async () => {
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'issues.opened',
                payload: {},
            };
            expect(await adapter.onWebhookReceived(event)).toBeNull();
        });

        it('returns null for unknown event types', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'pull_request.opened',
                payload: {},
            };
            expect(await adapter.onWebhookReceived(event)).toBeNull();
        });

        it('parses issues.opened into a new_issue TicketChange', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'issues.opened',
                payload: {
                    issue: {
                        number: 42,
                        title: 'Bug in CopilotKit',
                        body: 'It crashes on init',
                        html_url: 'https://github.com/CopilotKit/CopilotKit/issues/42',
                    },
                    repository: { full_name: 'CopilotKit/CopilotKit' },
                    sender: { login: 'user123' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).toEqual({
                externalId: 'CopilotKit/CopilotKit#42',
                action: 'new_issue',
                status: TicketStatus.OPEN,
                title: 'Bug in CopilotKit',
                description: 'It crashes on init',
                metadata: {
                    htmlUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
                    senderLogin: 'user123',
                },
            });
        });

        it('parses issues.closed into a status_change TicketChange', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'issues.closed',
                payload: {
                    issue: { number: 42 },
                    repository: { full_name: 'CopilotKit/CopilotKit' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).toEqual({
                externalId: 'CopilotKit/CopilotKit#42',
                action: 'status_change',
                status: TicketStatus.CLOSED,
            });
        });

        it('parses issues.reopened into a status_change TicketChange', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'issues.reopened',
                payload: {
                    issue: { number: 42 },
                    repository: { full_name: 'CopilotKit/CopilotKit' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).toEqual({
                externalId: 'CopilotKit/CopilotKit#42',
                action: 'status_change',
                status: TicketStatus.OPEN,
            });
        });

        it('parses issue_comment.created into a comment TicketChange', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'issue_comment.created',
                payload: {
                    comment: { id: 100, body: 'Still broken' },
                    issue: { number: 42 },
                    repository: { full_name: 'CopilotKit/CopilotKit' },
                    sender: { login: 'user123' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).toEqual({
                externalId: 'CopilotKit/CopilotKit#42',
                action: 'comment',
                comment: 'Still broken',
                metadata: {
                    commentId: 100,
                    senderLogin: 'user123',
                },
            });
        });

        it('parses discussion.created into a new_issue TicketChange', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'discussion.created',
                payload: {
                    discussion: {
                        number: 7,
                        title: 'How do I do X?',
                        body: 'Help please',
                        html_url: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
                        node_id: 'D_kwDOAbc',
                    },
                    repository: { full_name: 'CopilotKit/CopilotKit' },
                    sender: { login: 'asker' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).toEqual({
                externalId: 'CopilotKit/CopilotKit#7',
                action: 'new_issue',
                status: TicketStatus.OPEN,
                title: 'How do I do X?',
                description: 'Help please',
                metadata: {
                    htmlUrl: 'https://github.com/CopilotKit/CopilotKit/discussions/7',
                    nodeId: 'D_kwDOAbc',
                    senderLogin: 'asker',
                },
            });
        });

        it('returns null when issue payload is missing', async () => {
            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'issues.opened',
                payload: { repository: { full_name: 'CopilotKit/CopilotKit' } },
            };
            expect(await adapter.onWebhookReceived(event)).toBeNull();
        });
    });

    // ── pushStatusChange ──────────────────────────────────────────────

    describe('pushStatusChange', () => {
        it('closes a GitHub issue when status is CLOSED', async () => {
            const link = makeLink();
            await adapter.pushStatusChange(link, TicketStatus.CLOSED);

            expect(octokit.issues.update).toHaveBeenCalledWith({
                owner: 'CopilotKit',
                repo: 'CopilotKit',
                issue_number: 42,
                state: 'closed',
            });
        });

        it('reopens a GitHub issue when status is OPEN', async () => {
            const link = makeLink();
            await adapter.pushStatusChange(link, TicketStatus.OPEN);

            expect(octokit.issues.update).toHaveBeenCalledWith({
                owner: 'CopilotKit',
                repo: 'CopilotKit',
                issue_number: 42,
                state: 'open',
            });
        });

        it('maps RESOLVED to closed', async () => {
            const link = makeLink();
            await adapter.pushStatusChange(link, TicketStatus.RESOLVED);

            expect(octokit.issues.update).toHaveBeenCalledWith(
                expect.objectContaining({ state: 'closed' }),
            );
        });

        it('throws for invalid external ID format', async () => {
            const link = makeLink({ externalId: 'bad-format' });
            await expect(adapter.pushStatusChange(link, TicketStatus.CLOSED))
                .rejects.toThrow('Invalid GitHub external ID');
        });
    });

    // ── pushComment ───────────────────────────────────────────────────

    describe('pushComment', () => {
        it('posts a comment on the GitHub issue', async () => {
            const link = makeLink();
            await adapter.pushComment(link, 'This has been fixed.');

            expect(octokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'CopilotKit',
                repo: 'CopilotKit',
                issue_number: 42,
                body: 'This has been fixed.',
            });
        });

        it('throws for invalid external ID format', async () => {
            const link = makeLink({ externalId: 'nope' });
            await expect(adapter.pushComment(link, 'test'))
                .rejects.toThrow('Invalid GitHub external ID');
        });
    });

    // ── pushLabels ────────────────────────────────────────────────────

    describe('pushLabels', () => {
        it('sets labels on the GitHub issue', async () => {
            const link = makeLink();
            await adapter.pushLabels(link, ['bug', 'priority:high']);

            expect(octokit.issues.setLabels).toHaveBeenCalledWith({
                owner: 'CopilotKit',
                repo: 'CopilotKit',
                issue_number: 42,
                labels: ['bug', 'priority:high'],
            });
        });
    });

    // ── Status Mapping ────────────────────────────────────────────────

    describe('mapStatusToOutpost', () => {
        it('maps "open" to OPEN', () => {
            expect(adapter.mapStatusToOutpost('open')).toBe(TicketStatus.OPEN);
        });

        it('maps "closed" to CLOSED', () => {
            expect(adapter.mapStatusToOutpost('closed')).toBe(TicketStatus.CLOSED);
        });

        it('defaults unknown statuses to OPEN', () => {
            expect(adapter.mapStatusToOutpost('unknown')).toBe(TicketStatus.OPEN);
        });
    });

    describe('mapStatusFromOutpost', () => {
        it('maps CLOSED to "closed"', () => {
            expect(adapter.mapStatusFromOutpost(TicketStatus.CLOSED)).toBe('closed');
        });

        it('maps RESOLVED to "closed"', () => {
            expect(adapter.mapStatusFromOutpost(TicketStatus.RESOLVED)).toBe('closed');
        });

        it('maps OPEN to "open"', () => {
            expect(adapter.mapStatusFromOutpost(TicketStatus.OPEN)).toBe('open');
        });

        it('maps IN_PROGRESS to "open"', () => {
            expect(adapter.mapStatusFromOutpost(TicketStatus.IN_PROGRESS)).toBe('open');
        });

        it('maps WAITING_ON_CUSTOMER to "open"', () => {
            expect(adapter.mapStatusFromOutpost(TicketStatus.WAITING_ON_CUSTOMER)).toBe('open');
        });

        it('maps WAITING_ON_TEAM to "open"', () => {
            expect(adapter.mapStatusFromOutpost(TicketStatus.WAITING_ON_TEAM)).toBe('open');
        });
    });
});
