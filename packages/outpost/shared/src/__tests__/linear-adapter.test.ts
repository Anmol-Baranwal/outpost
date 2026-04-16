/**
 * Tests for LinearAdapter — webhook parsing, push operations,
 * status/priority/label mapping, and identity resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinearAdapter } from '../sync/adapters/linear.js';
import type { LinearClientLike, LinearAdapterConfig } from '../sync/adapters/linear.js';
import type { WebhookEvent, TicketExternalLinkRef } from '../sync/types.js';
import { TicketStatus, TicketPriority } from '../types.js';
import { createLinearStatusMap } from '../sync/status-map.js';
import { createLinearPriorityMap } from '../sync/priority-map.js';
import { createLinearLabelMapper } from '../sync/label-map.js';
import type { IdentityMapper } from '../sync/identity-map.js';

// ─── Mock Factories ────────────────────────────────────────────────────────

function makeMockClient(): LinearClientLike {
    return {
        createIssue: vi.fn().mockResolvedValue({
            success: true,
            issue: Promise.resolve({ id: 'lin-issue-1' }),
        }),
        createComment: vi.fn().mockResolvedValue({ success: true }),
        workflowStates: vi.fn().mockResolvedValue({
            nodes: [
                { id: 'ws-triage', name: 'Triage' },
                { id: 'ws-inprogress', name: 'In Progress' },
                { id: 'ws-done', name: 'Done' },
                { id: 'ws-canceled', name: 'Canceled' },
                { id: 'ws-backlog', name: 'Backlog' },
                { id: 'ws-todo', name: 'Todo' },
            ],
        }),
        issueLabels: vi.fn().mockResolvedValue({
            nodes: [
                { id: 'label-bug', name: 'Bug' },
                { id: 'label-feature', name: 'Feature' },
            ],
        }),
        issue: vi.fn().mockResolvedValue({
            id: 'lin-issue-1',
            update: vi.fn().mockResolvedValue({ success: true }),
        }),
    };
}

function makeMockIdentityMapper(): IdentityMapper {
    return {
        resolve: vi.fn().mockResolvedValue(null),
        register: vi.fn().mockResolvedValue(undefined),
        bulkResolve: vi.fn().mockResolvedValue(new Map()),
    } as unknown as IdentityMapper;
}

function makeAdapter(
    client?: LinearClientLike,
    identityMapper?: IdentityMapper,
): { adapter: LinearAdapter; client: LinearClientLike; identityMapper: IdentityMapper } {
    const mockClient = client ?? makeMockClient();
    const mockIdentity = identityMapper ?? makeMockIdentityMapper();

    const config: LinearAdapterConfig = {
        apiKey: 'test-key',
        teamId: 'team-1',
        statusMap: createLinearStatusMap(),
        priorityMap: createLinearPriorityMap(),
        labelMapper: createLinearLabelMapper(),
        identityMapper: mockIdentity,
    };

    const adapter = new LinearAdapter(config, mockClient);
    return { adapter, client: mockClient, identityMapper: mockIdentity };
}

function makeLink(overrides?: Partial<TicketExternalLinkRef>): TicketExternalLinkRef {
    return {
        id: 'link-1',
        ticketId: 'ticket-1',
        plugin: 'linear',
        externalId: 'lin-issue-1',
        externalUrl: 'https://linear.app/team/issue/LIN-1',
        ...overrides,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('LinearAdapter', () => {
    describe('name', () => {
        it('should be "linear"', () => {
            const { adapter } = makeAdapter();
            expect(adapter.name).toBe('linear');
        });
    });

    describe('pushNewIssue', () => {
        it('creates issue and returns the external ID', async () => {
            const { adapter, client } = makeAdapter();

            const id = await adapter.pushNewIssue({
                id: 'ticket-1',
                title: 'Test Issue',
                description: 'Test description',
                status: TicketStatus.IN_PROGRESS,
                priority: TicketPriority.HIGH,
            });

            expect(id).toBe('lin-issue-1');
            expect(client.createIssue).toHaveBeenCalledWith({
                teamId: 'team-1',
                title: 'Test Issue',
                description: 'Test description',
                stateId: 'ws-inprogress',
                priority: 2, // HIGH → 2
            });
        });

        it('throws when Linear API returns failure', async () => {
            const client = makeMockClient();
            (client.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
                success: false,
                issue: Promise.resolve({ id: '' }),
            });
            const { adapter } = makeAdapter(client);

            await expect(adapter.pushNewIssue({
                id: 'ticket-1',
                title: 'Fail Issue',
                description: '',
                status: TicketStatus.OPEN,
                priority: TicketPriority.MEDIUM,
            })).rejects.toThrow('Failed to create Linear issue');
        });

        it('maps CRITICAL priority to Linear 1 (Urgent)', async () => {
            const { adapter, client } = makeAdapter();

            await adapter.pushNewIssue({
                id: 'ticket-1',
                title: 'Urgent',
                description: '',
                status: TicketStatus.OPEN,
                priority: TicketPriority.CRITICAL,
            });

            expect(client.createIssue).toHaveBeenCalledWith(
                expect.objectContaining({ priority: 1 }),
            );
        });

        it('maps LOW priority to Linear 4', async () => {
            const { adapter, client } = makeAdapter();

            await adapter.pushNewIssue({
                id: 'ticket-1',
                title: 'Low',
                description: '',
                status: TicketStatus.OPEN,
                priority: TicketPriority.LOW,
            });

            expect(client.createIssue).toHaveBeenCalledWith(
                expect.objectContaining({ priority: 4 }),
            );
        });
    });

    describe('pushStatusChange', () => {
        it('resolves workflow state and updates the issue', async () => {
            const { adapter, client } = makeAdapter();
            const link = makeLink();

            await adapter.pushStatusChange(link, TicketStatus.IN_PROGRESS);

            expect(client.workflowStates).toHaveBeenCalledWith({
                team: { id: { eq: 'team-1' } },
            });
            expect(client.issue).toHaveBeenCalledWith('lin-issue-1');

            const issue = await client.issue('lin-issue-1');
            expect(issue.update).toHaveBeenCalledWith({ stateId: 'ws-inprogress' });
        });

        it('throws when no workflow state found', async () => {
            const client = makeMockClient();
            (client.workflowStates as ReturnType<typeof vi.fn>).mockResolvedValue({
                nodes: [],
            });
            const { adapter } = makeAdapter(client);
            const link = makeLink();

            await expect(
                adapter.pushStatusChange(link, TicketStatus.IN_PROGRESS),
            ).rejects.toThrow('No Linear workflow state found');
        });
    });

    describe('pushComment', () => {
        it('creates a comment on the issue', async () => {
            const { adapter, client } = makeAdapter();
            const link = makeLink();

            await adapter.pushComment(link, 'Hello from Outpost');

            expect(client.createComment).toHaveBeenCalledWith({
                issueId: 'lin-issue-1',
                body: 'Hello from Outpost',
            });
        });

        it('throws when comment creation fails', async () => {
            const client = makeMockClient();
            (client.createComment as ReturnType<typeof vi.fn>).mockResolvedValue({
                success: false,
            });
            const { adapter } = makeAdapter(client);
            const link = makeLink();

            await expect(
                adapter.pushComment(link, 'fail'),
            ).rejects.toThrow('Failed to create Linear comment');
        });
    });

    describe('pushPriority', () => {
        it('maps priority correctly and updates issue', async () => {
            const client = makeMockClient();
            const mockUpdate = vi.fn().mockResolvedValue({ success: true });
            (client.issue as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'lin-issue-1',
                update: mockUpdate,
            });
            const { adapter } = makeAdapter(client);
            const link = makeLink();

            await adapter.pushPriority(link, TicketPriority.CRITICAL);

            expect(mockUpdate).toHaveBeenCalledWith({ priority: 1 });
        });

        it('maps MEDIUM to 3', async () => {
            const client = makeMockClient();
            const mockUpdate = vi.fn().mockResolvedValue({ success: true });
            (client.issue as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'lin-issue-1',
                update: mockUpdate,
            });
            const { adapter } = makeAdapter(client);
            const link = makeLink();

            await adapter.pushPriority(link, TicketPriority.MEDIUM);

            expect(mockUpdate).toHaveBeenCalledWith({ priority: 3 });
        });
    });

    describe('pushLabels', () => {
        it('resolves label IDs and updates the issue', async () => {
            const client = makeMockClient();
            const mockUpdate = vi.fn().mockResolvedValue({ success: true });
            (client.issue as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'lin-issue-1',
                update: mockUpdate,
            });
            const { adapter } = makeAdapter(client);
            const link = makeLink();

            await adapter.pushLabels(link, ['Bug', 'Feature']);

            expect(client.issueLabels).toHaveBeenCalledWith({
                team: { id: { eq: 'team-1' } },
            });
            expect(mockUpdate).toHaveBeenCalledWith({
                labelIds: ['label-bug', 'label-feature'],
            });
        });
    });

    describe('onWebhookReceived', () => {
        it('parses issue creation events', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.create',
                payload: {
                    type: 'Issue',
                    action: 'create',
                    data: {
                        id: 'issue-new',
                        title: 'New Bug',
                        description: 'Something broke',
                        priority: 2,
                        state: { name: 'In Progress' },
                    },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).not.toBeNull();
            expect(change!.externalId).toBe('issue-new');
            expect(change!.action).toBe('new_issue');
            expect(change!.title).toBe('New Bug');
            expect(change!.status).toBe(TicketStatus.IN_PROGRESS);
            expect(change!.priority).toBe(TicketPriority.HIGH);
        });

        it('parses status change events', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.update',
                payload: {
                    type: 'Issue',
                    action: 'update',
                    data: {
                        id: 'issue-1',
                        state: { name: 'Done' },
                    },
                    updatedFrom: { stateId: 'old-state' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).not.toBeNull();
            expect(change!.action).toBe('status_change');
            expect(change!.status).toBe(TicketStatus.RESOLVED);
        });

        it('parses priority change events', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.update',
                payload: {
                    type: 'Issue',
                    action: 'update',
                    data: {
                        id: 'issue-1',
                        priority: 1,
                    },
                    updatedFrom: { priority: 3 },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).not.toBeNull();
            expect(change!.action).toBe('priority_change');
            expect(change!.priority).toBe(TicketPriority.CRITICAL);
        });

        it('parses comment creation events', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Comment.create',
                payload: {
                    type: 'Comment',
                    action: 'create',
                    data: {
                        body: 'Looks good!',
                        issue: { id: 'issue-1' },
                    },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).not.toBeNull();
            expect(change!.action).toBe('comment');
            expect(change!.comment).toBe('Looks good!');
            expect(change!.externalId).toBe('issue-1');
        });

        it('parses assignee change events', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.update',
                payload: {
                    type: 'Issue',
                    action: 'update',
                    data: {
                        id: 'issue-1',
                        assigneeId: 'user-42',
                    },
                    updatedFrom: { assigneeId: 'user-old' },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).not.toBeNull();
            expect(change!.action).toBe('assignee_change');
            expect(change!.assigneeExternalId).toBe('user-42');
        });

        it('parses label change events', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.update',
                payload: {
                    type: 'Issue',
                    action: 'update',
                    data: {
                        id: 'issue-1',
                        labels: [{ name: 'Bug' }, { name: 'Feature' }],
                    },
                    updatedFrom: { labelIds: ['old-id'] },
                },
            };

            const change = await adapter.onWebhookReceived(event);

            expect(change).not.toBeNull();
            expect(change!.action).toBe('label_change');
            expect(change!.labels).toEqual(['Bug', 'Feature']);
        });

        it('returns null for unsupported event types', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Project.update',
                payload: {
                    type: 'Project',
                    action: 'update',
                    data: { id: 'proj-1' },
                },
            };

            const change = await adapter.onWebhookReceived(event);
            expect(change).toBeNull();
        });

        it('returns null when update has no updatedFrom', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.update',
                payload: {
                    type: 'Issue',
                    action: 'update',
                    data: { id: 'issue-1' },
                },
            };

            const change = await adapter.onWebhookReceived(event);
            expect(change).toBeNull();
        });

        it('parses issue removal as close', async () => {
            const { adapter } = makeAdapter();
            const event: WebhookEvent = {
                plugin: 'linear',
                eventType: 'Issue.remove',
                payload: {
                    type: 'Issue',
                    action: 'remove',
                    data: { id: 'issue-del' },
                },
            };

            const change = await adapter.onWebhookReceived(event);
            expect(change).not.toBeNull();
            expect(change!.action).toBe('close');
            expect(change!.externalId).toBe('issue-del');
        });
    });

    describe('mapUserToMember', () => {
        it('delegates to identity mapper', async () => {
            const identityMapper = makeMockIdentityMapper();
            const member = { id: 'tm-1', name: 'Alice', email: 'alice@test.com' };
            (identityMapper.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(member);
            const { adapter } = makeAdapter(undefined, identityMapper);

            const result = await adapter.mapUserToMember('linear-user-1');

            expect(identityMapper.resolve).toHaveBeenCalledWith('linear', 'linear-user-1');
            expect(result).toEqual(member);
        });

        it('returns null when no mapping exists', async () => {
            const { adapter } = makeAdapter();

            const result = await adapter.mapUserToMember('unknown-user');
            expect(result).toBeNull();
        });
    });

    describe('status mapping', () => {
        it('maps "In Progress" to IN_PROGRESS', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapStatusToOutpost('In Progress')).toBe(TicketStatus.IN_PROGRESS);
        });

        it('maps "Done" to RESOLVED', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapStatusToOutpost('Done')).toBe(TicketStatus.RESOLVED);
        });

        it('maps "Canceled" to CLOSED', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapStatusToOutpost('Canceled')).toBe(TicketStatus.CLOSED);
        });

        it('maps unknown status to OPEN', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapStatusToOutpost('SomethingWeird')).toBe(TicketStatus.OPEN);
        });

        it('maps RESOLVED back to "Done"', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapStatusFromOutpost(TicketStatus.RESOLVED)).toBe('Done');
        });
    });

    describe('priority mapping', () => {
        it('maps "1" (Urgent) to CRITICAL', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapPriorityToOutpost('1')).toBe(TicketPriority.CRITICAL);
        });

        it('maps "4" (Low) to LOW', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapPriorityToOutpost('4')).toBe(TicketPriority.LOW);
        });

        it('maps "0" (None) to MEDIUM', () => {
            const { adapter } = makeAdapter();
            expect(adapter.mapPriorityToOutpost('0')).toBe(TicketPriority.MEDIUM);
        });
    });

    describe('workflow state caching', () => {
        it('only fetches workflow states once', async () => {
            const { adapter, client } = makeAdapter();
            const link = makeLink();

            await adapter.pushStatusChange(link, TicketStatus.IN_PROGRESS);
            await adapter.pushStatusChange(link, TicketStatus.RESOLVED);

            // workflowStates should be called only once (cached after first call)
            expect(client.workflowStates).toHaveBeenCalledTimes(1);
        });
    });
});
