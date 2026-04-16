/**
 * Tests for SyncEngine — plugin registry, fan-out, echo detection,
 * and SyncEvent recording.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../sync/engine.js';
import type { SyncEngineDeps } from '../sync/engine.js';
import type {
    ExternalTracker,
    InternalTracker,
    WebhookEvent,
    TicketChange,
    TicketExternalLinkRef,
    TeamMemberRef,
} from '../sync/types.js';
import { TicketStatus, TicketPriority } from '../types.js';

// ─── Mock Factories ────────────────────────────────────────────────────────

function makeMockDeps(): SyncEngineDeps {
    return {
        prisma: {
            syncEvent: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({ id: 'se-1' }),
            },
            ticketExternalLink: {
                findMany: vi.fn().mockResolvedValue([]),
                findUnique: vi.fn().mockResolvedValue(null),
            },
            ticket: {
                findUnique: vi.fn().mockResolvedValue(null),
                update: vi.fn().mockResolvedValue({}),
            },
        },
        createJob: vi.fn().mockResolvedValue('job-1'),
    };
}

function makeExternalTracker(name: string): ExternalTracker {
    return {
        name,
        onWebhookReceived: vi.fn().mockResolvedValue(null),
        pushStatusChange: vi.fn().mockResolvedValue(undefined),
        pushComment: vi.fn().mockResolvedValue(undefined),
        pushLabels: vi.fn().mockResolvedValue(undefined),
        mapStatusToOutpost: vi.fn().mockReturnValue(TicketStatus.OPEN),
        mapStatusFromOutpost: vi.fn().mockReturnValue('open'),
    };
}

function makeInternalTracker(name: string): InternalTracker {
    return {
        ...makeExternalTracker(name),
        pushNewIssue: vi.fn().mockResolvedValue('ext-123'),
        pushAssignee: vi.fn().mockResolvedValue(undefined),
        pushPriority: vi.fn().mockResolvedValue(undefined),
        mapPriorityToOutpost: vi.fn().mockReturnValue(TicketPriority.MEDIUM),
        mapPriorityFromOutpost: vi.fn().mockReturnValue('medium'),
        mapUserToMember: vi.fn().mockResolvedValue(null),
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('SyncEngine', () => {
    let deps: SyncEngineDeps;
    let engine: SyncEngine;

    beforeEach(() => {
        deps = makeMockDeps();
        engine = new SyncEngine(deps);
    });

    // ─── Plugin Registry ───────────────────────────────────────────

    describe('plugin registry', () => {
        it('registers an external tracker and retrieves it', () => {
            const tracker = makeExternalTracker('github');
            engine.registerExternalTracker(tracker);

            expect(engine.getPlugin('github')).toBe(tracker);
            expect(engine.getPluginNames()).toContain('github');
        });

        it('registers an internal tracker and retrieves it', () => {
            const tracker = makeInternalTracker('linear');
            engine.registerInternalTracker(tracker);

            expect(engine.getPlugin('linear')).toBe(tracker);
            expect(engine.isInternalTracker('linear')).toBe(true);
        });

        it('throws on duplicate plugin name', () => {
            engine.registerExternalTracker(makeExternalTracker('github'));

            expect(() => {
                engine.registerExternalTracker(makeExternalTracker('github'));
            }).toThrow('Plugin "github" is already registered');
        });

        it('throws when registering internal tracker with existing external name', () => {
            engine.registerExternalTracker(makeExternalTracker('github'));

            expect(() => {
                engine.registerInternalTracker(makeInternalTracker('github'));
            }).toThrow('Plugin "github" is already registered');
        });

        it('returns undefined for unregistered plugin', () => {
            expect(engine.getPlugin('nonexistent')).toBeUndefined();
        });

        it('isInternalTracker returns false for external tracker', () => {
            engine.registerExternalTracker(makeExternalTracker('github'));
            expect(engine.isInternalTracker('github')).toBe(false);
        });
    });

    // ─── Fan-Out ───────────────────────────────────────────────────

    describe('onTicketChange (fan-out)', () => {
        it('enqueues jobs for all plugins except the source', async () => {
            engine.registerExternalTracker(makeExternalTracker('github'));
            engine.registerExternalTracker(makeExternalTracker('gitlab'));
            engine.registerInternalTracker(makeInternalTracker('linear'));

            const change: TicketChange = {
                externalId: 'ext-1',
                action: 'status_change',
                status: TicketStatus.RESOLVED,
            };

            const result = await engine.onTicketChange('tkt-1', change, 'github');

            expect(result.success).toBe(true);
            // Should notify gitlab and linear, but NOT github (the source)
            expect(result.pluginsNotified).toBe(2);
            expect(deps.createJob).toHaveBeenCalledTimes(2);

            // Verify the job payloads
            const calls = vi.mocked(deps.createJob).mock.calls;
            const targetPlugins = calls.map(c => (c[1] as Record<string, unknown>).targetPlugin);
            expect(targetPlugins).toContain('gitlab');
            expect(targetPlugins).toContain('linear');
            expect(targetPlugins).not.toContain('github');
        });

        it('skips source plugin even when it is the only one', async () => {
            engine.registerExternalTracker(makeExternalTracker('github'));

            const change: TicketChange = {
                externalId: 'ext-1',
                action: 'comment',
                comment: 'hello',
            };

            const result = await engine.onTicketChange('tkt-1', change, 'github');

            expect(result.success).toBe(true);
            expect(result.pluginsNotified).toBe(0);
            expect(deps.createJob).not.toHaveBeenCalled();
        });

        it('reports errors when createJob fails', async () => {
            engine.registerExternalTracker(makeExternalTracker('github'));
            engine.registerExternalTracker(makeExternalTracker('gitlab'));

            vi.mocked(deps.createJob).mockRejectedValue(new Error('queue down'));

            const change: TicketChange = {
                externalId: 'ext-1',
                action: 'label_change',
                labels: ['bug'],
            };

            const result = await engine.onTicketChange('tkt-1', change, 'github');

            expect(result.success).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].plugin).toBe('gitlab');
            expect(result.errors[0].error).toBe('queue down');
        });
    });

    // ─── Echo Detection ────────────────────────────────────────────

    describe('echo detection', () => {
        it('skips fan-out when a matching SyncEvent exists', async () => {
            engine.registerExternalTracker(makeExternalTracker('github'));
            engine.registerExternalTracker(makeExternalTracker('gitlab'));

            // Simulate a recent SyncEvent matching the reverse direction
            vi.mocked(deps.prisma.syncEvent!.findFirst).mockResolvedValue({
                id: 'se-existing',
                createdAt: new Date(),
            });

            const change: TicketChange = {
                externalId: 'ext-1',
                action: 'status_change',
                status: TicketStatus.CLOSED,
            };

            const result = await engine.onTicketChange('tkt-1', change, 'github');

            expect(result.success).toBe(true);
            // Echo detected, so no jobs should be created
            expect(result.pluginsNotified).toBe(0);
            expect(deps.createJob).not.toHaveBeenCalled();
        });

        it('does not skip when no matching SyncEvent exists', async () => {
            engine.registerExternalTracker(makeExternalTracker('github'));
            engine.registerExternalTracker(makeExternalTracker('gitlab'));

            vi.mocked(deps.prisma.syncEvent!.findFirst).mockResolvedValue(null);

            const change: TicketChange = {
                externalId: 'ext-1',
                action: 'comment',
                comment: 'test',
            };

            const result = await engine.onTicketChange('tkt-1', change, 'github');

            expect(result.pluginsNotified).toBe(1);
        });
    });

    // ─── SyncEvent Recording ───────────────────────────────────────

    describe('recordSyncEvent', () => {
        it('creates a success SyncEvent via EchoGuard', async () => {
            await engine.recordSyncEvent(
                'outpost',
                'github',
                'ticket',
                'tkt-1',
                'status_change',
                'abc123',
                'success',
            );

            expect(deps.prisma.syncEvent!.create).toHaveBeenCalledWith({
                data: {
                    sourcePlugin: 'outpost',
                    targetPlugin: 'github',
                    entityType: 'ticket',
                    entityId: 'tkt-1',
                    action: 'status_change',
                    payloadHash: 'abc123',
                    status: 'success',
                    error: null,
                },
            });
        });

        it('creates a failure SyncEvent with error message via EchoGuard', async () => {
            await engine.recordSyncEvent(
                'outpost',
                'github',
                'ticket',
                'tkt-1',
                'comment',
                'def456',
                'failure',
                'API rate limited',
            );

            expect(deps.prisma.syncEvent!.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    status: 'failure',
                    error: 'API rate limited',
                }),
            });
        });
    });

    // ─── Webhook Processing ────────────────────────────────────────

    describe('onWebhookReceived', () => {
        it('returns error when plugin is not registered', async () => {
            const event: WebhookEvent = {
                plugin: 'unknown',
                eventType: 'issue.opened',
                payload: {},
            };

            const result = await engine.onWebhookReceived('unknown', event);

            expect(result.success).toBe(false);
            expect(result.errors[0].error).toContain('not registered');
        });

        it('returns success with 0 notifications when plugin skips event', async () => {
            const tracker = makeExternalTracker('github');
            vi.mocked(tracker.onWebhookReceived).mockResolvedValue(null);
            engine.registerExternalTracker(tracker);

            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'ping',
                payload: {},
            };

            const result = await engine.onWebhookReceived('github', event);

            expect(result.success).toBe(true);
            expect(result.pluginsNotified).toBe(0);
        });

        it('updates ticket status and fans out on status_change webhook', async () => {
            const github = makeExternalTracker('github');
            const linear = makeInternalTracker('linear');

            const change: TicketChange = {
                externalId: 'gh-issue-42',
                action: 'status_change',
                status: TicketStatus.RESOLVED,
            };
            vi.mocked(github.onWebhookReceived).mockResolvedValue(change);

            engine.registerExternalTracker(github);
            engine.registerInternalTracker(linear);

            // Simulate finding the linked ticket
            vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue({
                id: 'link-1',
                ticketId: 'tkt-1',
                plugin: 'github',
                externalId: 'gh-issue-42',
                externalUrl: 'https://github.com/org/repo/issues/42',
                metadata: null,
            });

            const event: WebhookEvent = {
                plugin: 'github',
                eventType: 'issues.closed',
                payload: { action: 'closed' },
            };

            const result = await engine.onWebhookReceived('github', event);

            // Should have updated the ticket status locally
            expect(deps.prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'tkt-1' },
                data: { status: TicketStatus.RESOLVED },
            });

            // Should have fanned out to linear (not github)
            expect(result.pluginsNotified).toBe(1);
        });

        it('returns success with 0 notifications when no link found', async () => {
            const github = makeExternalTracker('github');
            vi.mocked(github.onWebhookReceived).mockResolvedValue({
                externalId: 'orphan-123',
                action: 'comment',
                comment: 'hello',
            });
            engine.registerExternalTracker(github);

            vi.mocked(deps.prisma.ticketExternalLink.findUnique).mockResolvedValue(null);

            const result = await engine.onWebhookReceived('github', {
                plugin: 'github',
                eventType: 'issue_comment.created',
                payload: {},
            });

            expect(result.success).toBe(true);
            expect(result.pluginsNotified).toBe(0);
        });
    });

    // ─── Hash Computation ──────────────────────────────────────────

    describe('computeHash', () => {
        it('produces deterministic hashes for the same input', () => {
            const h1 = engine.computeHash('tkt-1', 'github', 'status_change', {
                status: 'RESOLVED',
            });
            const h2 = engine.computeHash('tkt-1', 'github', 'status_change', {
                status: 'RESOLVED',
            });
            expect(h1).toBe(h2);
        });

        it('produces different hashes for different inputs', () => {
            const h1 = engine.computeHash('tkt-1', 'github', 'status_change', {
                status: 'RESOLVED',
            });
            const h2 = engine.computeHash('tkt-1', 'github', 'status_change', {
                status: 'CLOSED',
            });
            expect(h1).not.toBe(h2);
        });

        it('returns a 16-character hex string', () => {
            const hash = engine.computeHash('tkt-1', 'github', 'comment', {
                comment: 'hello',
            });
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });
    });
});
