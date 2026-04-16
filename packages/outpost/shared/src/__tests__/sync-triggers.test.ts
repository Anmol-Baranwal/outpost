/**
 * Tests for sync triggers, hooks, enrichment fan-out, and SyncEngine initialization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../sync/engine.js';
import type { SyncEngineDeps } from '../sync/engine.js';
import type { InternalTracker, ExternalTracker } from '../sync/types.js';
import { TicketStatus, TicketPriority, MessageType } from '../types.js';
import {
    onTicketCreated,
    onTicketUpdated,
    onMessageCreated,
    registerSyncTriggers,
} from '../sync/triggers.js';
import type { SyncTicket, SyncMessage, TicketChanges } from '../sync/triggers.js';
import { createSyncHooks } from '../sync/hooks.js';
import { onAiClassification, onAiResponse, onRoutingAssignment } from '../sync/enrichment.js';
import { initializeSyncEngine } from '../sync/init.js';

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

function makeInternalTracker(name: string): InternalTracker {
    return {
        name,
        onWebhookReceived: vi.fn().mockResolvedValue(null),
        pushStatusChange: vi.fn().mockResolvedValue(undefined),
        pushComment: vi.fn().mockResolvedValue(undefined),
        pushLabels: vi.fn().mockResolvedValue(undefined),
        mapStatusToOutpost: vi.fn().mockReturnValue(TicketStatus.OPEN),
        mapStatusFromOutpost: vi.fn().mockReturnValue('open'),
        pushNewIssue: vi.fn().mockResolvedValue('ext-123'),
        pushAssignee: vi.fn().mockResolvedValue(undefined),
        pushPriority: vi.fn().mockResolvedValue(undefined),
        mapPriorityToOutpost: vi.fn().mockReturnValue(TicketPriority.MEDIUM),
        mapPriorityFromOutpost: vi.fn().mockReturnValue('medium'),
        mapUserToMember: vi.fn().mockResolvedValue(null),
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

function makeTicket(overrides?: Partial<SyncTicket>): SyncTicket {
    return {
        id: 'tkt-1',
        title: 'Test ticket',
        description: 'A test ticket',
        status: TicketStatus.OPEN,
        priority: TicketPriority.MEDIUM,
        internalId: null,
        ...overrides,
    };
}

// ─── Trigger Tests ─────────────────────────────────────────────────────────

describe('Sync Triggers', () => {
    let deps: SyncEngineDeps;
    let engine: SyncEngine;

    beforeEach(() => {
        deps = makeMockDeps();
        engine = new SyncEngine(deps);
        engine.registerInternalTracker(makeInternalTracker('linear'));
    });

    describe('onTicketCreated', () => {
        it('enqueues a new_issue job when ticket has no internalId', async () => {
            const ticket = makeTicket();

            await onTicketCreated(engine, ticket, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                ticketId: 'tkt-1',
                targetPlugin: 'linear',
                action: 'new_issue',
            }));
        });

        it('skips when ticket already has an internalId', async () => {
            const ticket = makeTicket({ internalId: 'lin-123' });

            await onTicketCreated(engine, ticket, 'discord');

            expect(deps.createJob).not.toHaveBeenCalled();
        });

        it('skips the source system (loop prevention)', async () => {
            const ticket = makeTicket();

            await onTicketCreated(engine, ticket, 'linear');

            // linear is the only plugin, and it's the source — nothing to notify
            expect(deps.createJob).not.toHaveBeenCalled();
        });
    });

    describe('onTicketUpdated', () => {
        it('enqueues a status_change job', async () => {
            const ticket = makeTicket();
            const changes: TicketChanges = { status: TicketStatus.RESOLVED };

            await onTicketUpdated(engine, ticket, changes, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'status_change',
            }));
        });

        it('enqueues a priority_change job', async () => {
            const ticket = makeTicket();
            const changes: TicketChanges = { priority: TicketPriority.HIGH };

            await onTicketUpdated(engine, ticket, changes, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'priority_change',
            }));
        });

        it('enqueues an assignee_change job', async () => {
            const ticket = makeTicket();
            const changes: TicketChanges = { assigneeId: 'member-1' };

            await onTicketUpdated(engine, ticket, changes, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'assignee_change',
            }));
        });

        it('enqueues a label_change job', async () => {
            const ticket = makeTicket();
            const changes: TicketChanges = { labels: ['bug', 'critical'] };

            await onTicketUpdated(engine, ticket, changes, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'label_change',
            }));
        });

        it('enqueues multiple jobs for multiple changes', async () => {
            const ticket = makeTicket();
            const changes: TicketChanges = {
                status: TicketStatus.IN_PROGRESS,
                priority: TicketPriority.HIGH,
            };

            await onTicketUpdated(engine, ticket, changes, 'discord');

            expect(deps.createJob).toHaveBeenCalledTimes(2);
        });

        it('skips the source system (loop prevention)', async () => {
            const ticket = makeTicket();
            const changes: TicketChanges = { status: TicketStatus.RESOLVED };

            await onTicketUpdated(engine, ticket, changes, 'linear');

            expect(deps.createJob).not.toHaveBeenCalled();
        });

        it('does nothing when changes object is empty', async () => {
            const ticket = makeTicket();

            await onTicketUpdated(engine, ticket, {}, 'discord');

            expect(deps.createJob).not.toHaveBeenCalled();
        });
    });

    describe('onMessageCreated', () => {
        it('enqueues a comment job for USER messages', async () => {
            const ticket = makeTicket();
            const message: SyncMessage = { id: 'msg-1', body: 'Hello', type: MessageType.USER };

            await onMessageCreated(engine, ticket, message, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'comment',
            }));
        });

        it('enqueues a comment job for BOT messages', async () => {
            const ticket = makeTicket();
            const message: SyncMessage = { id: 'msg-2', body: 'Auto-reply', type: MessageType.BOT };

            await onMessageCreated(engine, ticket, message, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'comment',
            }));
        });

        it('skips SYSTEM messages', async () => {
            const ticket = makeTicket();
            const message: SyncMessage = { id: 'msg-3', body: 'Status changed', type: MessageType.SYSTEM };

            await onMessageCreated(engine, ticket, message, 'discord');

            expect(deps.createJob).not.toHaveBeenCalled();
        });

        it('skips the source system (loop prevention)', async () => {
            const ticket = makeTicket();
            const message: SyncMessage = { id: 'msg-4', body: 'From linear', type: MessageType.USER };

            await onMessageCreated(engine, ticket, message, 'linear');

            expect(deps.createJob).not.toHaveBeenCalled();
        });
    });

    describe('registerSyncTriggers', () => {
        it('returns bound trigger functions', async () => {
            const triggers = registerSyncTriggers(engine);

            const ticket = makeTicket();
            await triggers.onTicketCreated(ticket, 'discord');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'new_issue',
            }));
        });
    });
});

// ─── Hook Tests ────────────────────────────────────────────────────────────

describe('SyncHooks', () => {
    let deps: SyncEngineDeps;
    let engine: SyncEngine;

    beforeEach(() => {
        deps = makeMockDeps();
        engine = new SyncEngine(deps);
        engine.registerInternalTracker(makeInternalTracker('linear'));
    });

    it('afterTicketCreate fires onTicketCreated trigger', async () => {
        const hooks = createSyncHooks(engine);
        const ticket = makeTicket();

        await hooks.afterTicketCreate(ticket, 'discord');

        expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
            action: 'new_issue',
        }));
    });

    it('afterTicketUpdate fires onTicketUpdated trigger', async () => {
        const hooks = createSyncHooks(engine);
        const ticket = makeTicket();

        await hooks.afterTicketUpdate(ticket, { status: TicketStatus.RESOLVED }, 'slack');

        expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
            action: 'status_change',
        }));
    });

    it('afterMessageCreate fires onMessageCreated trigger', async () => {
        const hooks = createSyncHooks(engine);
        const ticket = makeTicket();
        const message: SyncMessage = { id: 'msg-1', body: 'Hello', type: MessageType.USER };

        await hooks.afterMessageCreate(ticket, message, 'github');

        expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
            action: 'comment',
        }));
    });

    it('swallows errors without throwing', async () => {
        vi.mocked(deps.createJob).mockRejectedValue(new Error('queue down'));
        const hooks = createSyncHooks(engine);
        const ticket = makeTicket();

        // Should not throw
        await hooks.afterTicketCreate(ticket, 'discord');
    });
});

// ─── Enrichment Tests ──────────────────────────────────────────────────────

describe('Enrichment Fan-Out', () => {
    let deps: SyncEngineDeps;
    let engine: SyncEngine;

    beforeEach(() => {
        deps = makeMockDeps();
        engine = new SyncEngine(deps);
        engine.registerInternalTracker(makeInternalTracker('linear'));
    });

    describe('onAiClassification', () => {
        it('pushes priority change to internal tracker', async () => {
            const ticket = makeTicket();

            await onAiClassification(engine, ticket, { priority: TicketPriority.CRITICAL });

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'priority_change',
            }));
        });

        it('pushes label changes to internal tracker', async () => {
            const ticket = makeTicket();

            await onAiClassification(engine, ticket, { labels: ['bug', 'sdk'] });

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'label_change',
            }));
        });

        it('pushes multiple classification fields', async () => {
            const ticket = makeTicket();

            await onAiClassification(engine, ticket, {
                priority: TicketPriority.HIGH,
                labels: ['feature-request'],
            });

            // Should enqueue 2 jobs: priority + labels
            expect(deps.createJob).toHaveBeenCalledTimes(2);
        });

        it('does nothing when classification result is empty', async () => {
            const ticket = makeTicket();

            await onAiClassification(engine, ticket, {});

            expect(deps.createJob).not.toHaveBeenCalled();
        });

        it('does nothing for empty labels array', async () => {
            const ticket = makeTicket();

            await onAiClassification(engine, ticket, { labels: [] });

            expect(deps.createJob).not.toHaveBeenCalled();
        });
    });

    describe('onAiResponse', () => {
        it('pushes AI response as comment', async () => {
            const ticket = makeTicket();

            await onAiResponse(engine, ticket, 'Here is a suggested fix...');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'comment',
            }));
        });
    });

    describe('onRoutingAssignment', () => {
        it('pushes assignee change to internal tracker', async () => {
            const ticket = makeTicket();

            await onRoutingAssignment(engine, ticket, 'member-42');

            expect(deps.createJob).toHaveBeenCalledWith('TRACKER_SYNC', expect.objectContaining({
                action: 'assignee_change',
            }));
        });
    });
});

// ─── Initialization Tests ──────────────────────────────────────────────────

describe('initializeSyncEngine', () => {
    it('registers Linear adapter when env vars are present', () => {
        const deps = makeMockDeps();
        const identityDeps = {
            externalIdentity: {
                findUnique: vi.fn().mockResolvedValue(null),
                findMany: vi.fn().mockResolvedValue([]),
                create: vi.fn().mockResolvedValue({ id: 'id-1', plugin: 'linear', externalId: 'ext-1', memberId: 'mem-1' }),
            },
        };

        const engine = initializeSyncEngine({
            deps,
            identityDeps,
            env: {
                LINEAR_API_KEY: 'test-key',
                LINEAR_TEAM_ID: 'team-123',
            },
        });

        expect(engine.getPlugin('linear')).toBeDefined();
        expect(engine.isInternalTracker('linear')).toBe(true);
    });

    it('skips Linear adapter when LINEAR_API_KEY is missing', () => {
        const deps = makeMockDeps();

        const engine = initializeSyncEngine({
            deps,
            env: {
                LINEAR_TEAM_ID: 'team-123',
            },
        });

        expect(engine.getPlugin('linear')).toBeUndefined();
    });

    it('skips Linear adapter when LINEAR_TEAM_ID is missing', () => {
        const deps = makeMockDeps();

        const engine = initializeSyncEngine({
            deps,
            env: {
                LINEAR_API_KEY: 'test-key',
            },
        });

        expect(engine.getPlugin('linear')).toBeUndefined();
    });

    it('returns a working engine with no adapters when env is empty', () => {
        const deps = makeMockDeps();

        const engine = initializeSyncEngine({
            deps,
            env: {},
        });

        expect(engine.getPluginNames()).toHaveLength(0);
    });

    it('skips Linear adapter when identityDeps is not provided', () => {
        const deps = makeMockDeps();

        const engine = initializeSyncEngine({
            deps,
            env: {
                LINEAR_API_KEY: 'test-key',
                LINEAR_TEAM_ID: 'team-123',
            },
        });

        // Without identityDeps, the adapter is not registered
        expect(engine.getPlugin('linear')).toBeUndefined();
    });
});
