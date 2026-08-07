import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockSyncEventFindMany = vi.fn();
const mockSyncEventFindFirst = vi.fn();
const mockSyncEventFindUnique = vi.fn();
const mockSyncEventCount = vi.fn();
const mockSyncEventUpdate = vi.fn();
const mockExternalIdentityFindMany = vi.fn();
const mockSystemConfigFindUnique = vi.fn();
const mockSystemConfigUpsert = vi.fn();
const mockTicketExternalLinkFindMany = vi.fn();
const mockTicketExternalLinkFindFirst = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        syncEvent: {
            findMany: (...args: unknown[]) => mockSyncEventFindMany(...args),
            findFirst: (...args: unknown[]) => mockSyncEventFindFirst(...args),
            findUnique: (...args: unknown[]) => mockSyncEventFindUnique(...args),
            count: (...args: unknown[]) => mockSyncEventCount(...args),
            update: (...args: unknown[]) => mockSyncEventUpdate(...args),
        },
        externalIdentity: {
            findMany: (...args: unknown[]) => mockExternalIdentityFindMany(...args),
        },
        systemConfig: {
            findUnique: (...args: unknown[]) => mockSystemConfigFindUnique(...args),
            upsert: (...args: unknown[]) => mockSystemConfigUpsert(...args),
        },
        ticketExternalLink: {
            findMany: (...args: unknown[]) => mockTicketExternalLinkFindMany(...args),
            findFirst: (...args: unknown[]) => mockTicketExternalLinkFindFirst(...args),
        },
    },
}));

// ─── Mock next-auth ─────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();

vi.mock('next-auth/next', () => ({
    getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('next-auth', () => ({
    getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// ─── Mock queue ─────────────────────────────────────────────────────────────

const mockCreateJob = vi.fn().mockResolvedValue('job-1');

vi.mock('@copilotkit/outpost/queue', () => ({
    createJob: (...args: unknown[]) => mockCreateJob(...args),
    JobType: { TRACKER_SYNC: 'TRACKER_SYNC' },
}));

// Import after mocks
import { GET as getStatus } from '@/app/api/sync/status/route';
import { GET as getConflicts } from '@/app/api/sync/conflicts/route';
import { POST as resolveConflict } from '@/app/api/sync/conflicts/[id]/resolve/route';
import { GET as getEvents } from '@/app/api/sync/events/route';
import { GET as getMappings, PUT as putMappings } from '@/app/api/sync/mappings/route';
import { POST as forceSync } from '@/app/api/sync/force/route';

// ─── Helpers ────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server';

function makeGetRequest(url: string): NextRequest {
    return new NextRequest(url, { method: 'GET' });
}

function makeJsonRequest(url: string, body: unknown, method = 'POST'): NextRequest {
    return new NextRequest(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ─── Session helpers ────────────────────────────────────────────────────────

function userSession(memberId = 'tm-1', role = 'ADMIN') {
    return {
        user: {
            id: memberId,
            name: 'Test User',
            email: 'test@test.com',
            role,
            memberId,
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/sync/status', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns system status', async () => {
        mockSyncEventFindMany.mockResolvedValue([
            { sourcePlugin: 'github', targetPlugin: 'outpost' },
            { sourcePlugin: 'outpost', targetPlugin: 'linear' },
        ]);
        mockSyncEventFindFirst.mockResolvedValue({ createdAt: new Date() });
        mockSyncEventCount.mockResolvedValue(0);

        const res = await getStatus();
        const body = await res.json();

        expect(body.systems).toBeDefined();
        expect(Array.isArray(body.systems)).toBe(true);
    });

    it('marks only plugins with a registered outbound adapter as force-syncable', async () => {
        // Drives the dashboard's force-sync control: github appears in System
        // Health because it has sync events, but the worker cannot sync to it.
        mockSyncEventFindMany.mockResolvedValue([
            { sourcePlugin: 'github', targetPlugin: 'outpost' },
            { sourcePlugin: 'outpost', targetPlugin: 'linear' },
        ]);
        mockSyncEventFindFirst.mockResolvedValue({ createdAt: new Date() });
        mockSyncEventCount.mockResolvedValue(0);

        const body = await (await getStatus()).json();
        const byPlugin = Object.fromEntries(
            body.systems.map((s: { plugin: string; canForceSync: boolean }) => [
                s.plugin,
                s.canForceSync,
            ]),
        );

        expect(byPlugin).toEqual({ github: false, linear: true });
    });

    it('returns empty when no sync events exist', async () => {
        mockSyncEventFindMany.mockResolvedValue([]);

        const res = await getStatus();
        const body = await res.json();

        expect(body.systems).toHaveLength(0);
    });
});

describe('GET /api/sync/conflicts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns unresolved conflicts', async () => {
        const conflicts = [
            { id: 'se-1', status: 'conflict', sourcePlugin: 'linear', targetPlugin: 'outpost' },
        ];
        mockSyncEventFindMany.mockResolvedValue(conflicts);

        const res = await getConflicts();
        const body = await res.json();

        expect(body.conflicts).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('returns empty when no conflicts', async () => {
        mockSyncEventFindMany.mockResolvedValue([]);

        const res = await getConflicts();
        const body = await res.json();

        expect(body.conflicts).toHaveLength(0);
    });
});

describe('POST /api/sync/conflicts/[id]/resolve', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('resolves a conflict', async () => {
        mockSyncEventFindUnique.mockResolvedValue({ id: 'se-1', status: 'conflict' });
        mockSyncEventUpdate.mockResolvedValue({ id: 'se-1', status: 'success' });

        const req = makeJsonRequest('http://localhost:3000/api/sync/conflicts/se-1/resolve', {
            resolution: 'outpost',
        });
        const res = await resolveConflict(req as never, {
            params: Promise.resolve({ id: 'se-1' }),
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.resolution).toBe('outpost');
    });

    it('returns 404 for non-existent conflict', async () => {
        mockSyncEventFindUnique.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/sync/conflicts/nope/resolve', {
            resolution: 'outpost',
        });
        const res = await resolveConflict(req as never, {
            params: Promise.resolve({ id: 'nope' }),
        });

        expect(res.status).toBe(404);
    });

    it('rejects invalid resolution', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/sync/conflicts/se-1/resolve', {
            resolution: 'invalid',
        });
        const res = await resolveConflict(req as never, {
            params: Promise.resolve({ id: 'se-1' }),
        });

        expect(res.status).toBe(400);
    });

    it('rejects when event is not a conflict', async () => {
        mockSyncEventFindUnique.mockResolvedValue({ id: 'se-1', status: 'success' });

        const req = makeJsonRequest('http://localhost:3000/api/sync/conflicts/se-1/resolve', {
            resolution: 'outpost',
        });
        const res = await resolveConflict(req as never, {
            params: Promise.resolve({ id: 'se-1' }),
        });

        expect(res.status).toBe(400);
    });
});

describe('GET /api/sync/events', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns paginated events', async () => {
        const events = [{ id: 'se-1', sourcePlugin: 'github', status: 'success' }];
        mockSyncEventFindMany.mockResolvedValue(events);
        mockSyncEventCount.mockResolvedValue(1);

        const req = makeGetRequest('http://localhost:3000/api/sync/events');
        const res = await getEvents(req as never);
        const body = await res.json();

        expect(body.events).toHaveLength(1);
        expect(body.total).toBe(1);
        expect(body.page).toBe(1);
    });

    it('returns empty when no events', async () => {
        mockSyncEventFindMany.mockResolvedValue([]);
        mockSyncEventCount.mockResolvedValue(0);

        const req = makeGetRequest('http://localhost:3000/api/sync/events');
        const res = await getEvents(req as never);
        const body = await res.json();

        expect(body.events).toHaveLength(0);
        expect(body.total).toBe(0);
    });
});

describe('GET /api/sync/mappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('falls back to defaults when no SystemConfig row exists', async () => {
        mockExternalIdentityFindMany.mockResolvedValue([]);
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const res = await getMappings();
        const body = await res.json();

        expect(body.statusMappings.linear).toContainEqual({
            externalStatus: 'Triage',
            outpostStatus: 'OPEN',
        });
        expect(body.priorityMappings).toBeDefined();
        expect(body.identityMappings).toBeDefined();
        expect(body.labelRules).toBeDefined();
    });

    it('returns the persisted config when a SystemConfig row exists', async () => {
        mockExternalIdentityFindMany.mockResolvedValue([]);
        const saved = {
            statusMappings: { linear: [{ externalStatus: 'Custom', outpostStatus: 'OPEN' }] },
            priorityMappings: {
                linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
            },
            labelRules: { linear: [] },
        };
        mockSystemConfigFindUnique.mockResolvedValue({
            key: 'sync.mappingConfig',
            value: JSON.stringify(saved),
        });

        const res = await getMappings();
        const body = await res.json();

        expect(body.statusMappings).toEqual(saved.statusMappings);
    });

    it('falls back to defaults when the persisted SystemConfig value is malformed JSON', async () => {
        mockExternalIdentityFindMany.mockResolvedValue([]);
        mockSystemConfigFindUnique.mockResolvedValue({
            key: 'sync.mappingConfig',
            value: 'not valid json {{{',
        });

        const res = await getMappings();
        const body = await res.json();

        expect(body.statusMappings.linear).toContainEqual({
            externalStatus: 'Triage',
            outpostStatus: 'OPEN',
        });
        expect(body.priorityMappings).toBeDefined();
        expect(body.identityMappings).toBeDefined();
        expect(body.labelRules).toBeDefined();
    });
});

describe('PUT /api/sync/mappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'ADMIN'));
    });

    it('persists a valid mapping update', async () => {
        const config = {
            statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
            priorityMappings: {
                linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
            },
        };
        mockSystemConfigUpsert.mockResolvedValue({
            key: 'sync.mappingConfig',
            value: JSON.stringify(config),
        });

        const req = makeJsonRequest('http://localhost:3000/api/sync/mappings', config, 'PUT');
        const res = await putMappings(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(mockSystemConfigUpsert).toHaveBeenCalledWith({
            where: { key: 'sync.mappingConfig' },
            update: { value: JSON.stringify(config) },
            create: { key: 'sync.mappingConfig', value: JSON.stringify(config) },
        });
        expect(body.statusMappings).toEqual(config.statusMappings);
    });

    it('rejects when required fields missing', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/sync/mappings', {}, 'PUT');
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('rejects statusMappings of the wrong type entirely', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: 'garbage',
                priorityMappings: {
                    linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
                },
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    // An empty per-plugin array used to pass validation, but loadStatusMap and
    // loadPriorityMap treat an empty array as "nothing persisted" and fall back to
    // the hardcoded defaults — so saving this left the dashboard showing NO
    // mappings while the worker kept applying Linear's defaults.
    it('rejects an empty per-plugin mapping array', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [] },
                priorityMappings: {
                    linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
                },
            },
            'PUT',
        );

        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('rejects a mapping with an unknown outpostStatus value', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [{ externalStatus: 'X', outpostStatus: 'NOT_REAL' }] },
                priorityMappings: {
                    linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
                },
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('rejects a mapping with an unknown outpostPriority value', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
                priorityMappings: {
                    linear: [{ externalPriority: 'X', outpostPriority: 'NOT_REAL' }],
                },
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('requires admin role', async () => {
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'MEMBER'));

        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
                priorityMappings: {
                    linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
                },
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(403);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('rejects completely empty statusMappings/priorityMappings objects instead of silently wiping config', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: {},
                priorityMappings: {},
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('rejects labelRules of the wrong type', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
                priorityMappings: {
                    linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
                },
                labelRules: 'garbage',
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('persists a valid labelRules update', async () => {
        const config = {
            statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
            priorityMappings: {
                linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
            },
            labelRules: { linear: [{ externalPrefix: 'Priority: ', outpostPrefix: '' }] },
        };
        mockSystemConfigUpsert.mockResolvedValue({
            key: 'sync.mappingConfig',
            value: JSON.stringify(config),
        });

        const req = makeJsonRequest('http://localhost:3000/api/sync/mappings', config, 'PUT');
        const res = await putMappings(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(mockSystemConfigUpsert).toHaveBeenCalledWith({
            where: { key: 'sync.mappingConfig' },
            update: { value: JSON.stringify(config) },
            create: { key: 'sync.mappingConfig', value: JSON.stringify(config) },
        });
        expect(body.labelRules).toEqual(config.labelRules);
    });

    it('rejects a completely empty labelRules object instead of silently wiping config', async () => {
        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
                priorityMappings: {
                    linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
                },
                labelRules: {},
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('does not mislabel a DB write failure as "Invalid request body"', async () => {
        const config = {
            statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
            priorityMappings: {
                linear: [{ externalPriority: 'Urgent', outpostPriority: 'CRITICAL' }],
            },
        };
        mockSystemConfigUpsert.mockRejectedValueOnce(new Error('db down'));

        const req = makeJsonRequest('http://localhost:3000/api/sync/mappings', config, 'PUT');

        await expect(putMappings(req as never)).rejects.toThrow('db down');
    });
});

describe('POST /api/sync/force', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'ADMIN'));
        mockTicketExternalLinkFindFirst.mockResolvedValue(null);
    });

    it('enqueues status_change and priority_change jobs for every ticket linked to the plugin', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
            {
                ticketId: 't-2',
                plugin: 'linear',
                ticket: { id: 't-2', status: 'RESOLVED', priority: 'LOW' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 2, jobs: 4, skipped: 0, unmappable: [] });
        expect(mockCreateJob).toHaveBeenCalledTimes(4);
        expect(mockCreateJob).toHaveBeenCalledWith('TRACKER_SYNC', {
            ticketId: 't-1',
            targetPlugin: 'linear',
            action: 'status_change',
            changeData: { status: 'OPEN' },
        });
        expect(mockCreateJob).toHaveBeenCalledWith('TRACKER_SYNC', {
            ticketId: 't-1',
            targetPlugin: 'linear',
            action: 'priority_change',
            changeData: { priority: 'HIGH' },
        });
    });

    it('returns zero counts and does not call createJob when no tickets are linked', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 0, jobs: 0, skipped: 0, unmappable: [] });
        expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('syncs only the given ticket when ticketId is provided', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', {
            plugin: 'linear',
            ticketId: 't-1',
        });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 1, jobs: 2, skipped: 0, unmappable: [] });
        expect(mockTicketExternalLinkFindMany).toHaveBeenCalledWith({
            where: { plugin: 'linear', ticketId: 't-1' },
            // Narrowed from `include: { ticket: true }`: the route only reads
            // id/status/priority, so it no longer pulls whole ticket rows.
            select: { ticket: { select: { id: true, status: true, priority: true } } },
        });
    });

    it('returns 404 for unknown plugin', async () => {
        mockSyncEventFindFirst.mockResolvedValue(null);
        mockTicketExternalLinkFindFirst.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'unknown' });
        const res = await forceSync(req as never);

        expect(res.status).toBe(404);
        expect(mockTicketExternalLinkFindMany).not.toHaveBeenCalled();
    });

    it('recognizes a plugin via TicketExternalLink even with no prior SyncEvent', async () => {
        mockSyncEventFindFirst.mockResolvedValue(null);
        mockTicketExternalLinkFindFirst.mockResolvedValue({ id: 'link-1', plugin: 'linear' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 1, jobs: 2, skipped: 0, unmappable: [] });
    });

    it('does not push a status with no reverse mapping, and says which', async () => {
        // WAITING_ON_CUSTOMER / WAITING_ON_TEAM are real TicketStatus values that
        // createLinearStatusMap does not cover. StatusMap.fromOutpost falls back to
        // its first entry ('Triage'), so enqueuing these would silently move every
        // waiting ticket's Linear issue to Triage and report success.
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'WAITING_ON_CUSTOMER', priority: 'HIGH' },
            },
            {
                ticketId: 't-2',
                plugin: 'linear',
                ticket: { id: 't-2', status: 'OPEN', priority: 'LOW' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        // t-1 contributes priority only; t-2 contributes both.
        expect(body).toEqual({
            queued: 2,
            jobs: 3,
            skipped: 1,
            unmappable: ['status:WAITING_ON_CUSTOMER'],
        });
        expect(mockCreateJob).toHaveBeenCalledTimes(3);
        expect(mockCreateJob).not.toHaveBeenCalledWith('TRACKER_SYNC', {
            ticketId: 't-1',
            targetPlugin: 'linear',
            action: 'status_change',
            changeData: { status: 'WAITING_ON_CUSTOMER' },
        });
        // The rest of the resync still goes through.
        expect(mockCreateJob).toHaveBeenCalledWith('TRACKER_SYNC', {
            ticketId: 't-1',
            targetPlugin: 'linear',
            action: 'priority_change',
            changeData: { priority: 'HIGH' },
        });
    });

    it('collapses repeated unmappable values instead of listing every ticket', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'WAITING_ON_TEAM', priority: 'HIGH' },
            },
            {
                ticketId: 't-2',
                plugin: 'linear',
                ticket: { id: 't-2', status: 'WAITING_ON_TEAM', priority: 'LOW' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const body = await (await forceSync(req as never)).json();

        expect(body.skipped).toBe(2);
        expect(body.unmappable).toEqual(['status:WAITING_ON_TEAM']);
    });

    it('reads the mapping config once, not once per loader', async () => {
        // loadStatusMap and loadPriorityMap each look up the same
        // sync.mappingConfig row; they share one read via singleReadConfigDb.
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
        ]);
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        await forceSync(req as never);

        expect(mockSystemConfigFindUnique).toHaveBeenCalledTimes(1);
    });

    it('loads no mapping config at all when nothing is linked', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        await forceSync(req as never);

        expect(mockSystemConfigFindUnique).not.toHaveBeenCalled();
    });

    it('refuses a known plugin that has no registered outbound adapter', async () => {
        // github-app writes SyncEvent and TicketExternalLink rows, so 'github'
        // clears the existence probes — but buildSyncEngine registers Linear only.
        // Enqueuing here would produce 2N jobs that each fail "Plugin is not
        // registered" and retry into the DLQ.
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindFirst.mockResolvedValue({ id: 'link-1', plugin: 'github' });

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'github' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toContain('no outbound sync adapter');
        expect(mockTicketExternalLinkFindMany).not.toHaveBeenCalled();
        expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('rejects when plugin is missing', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/sync/force', {});
        const res = await forceSync(req as never);

        expect(res.status).toBe(400);
    });

    it('still returns 400 "Invalid request body" for malformed JSON', async () => {
        const req = new NextRequest('http://localhost:3000/api/sync/force', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe('Invalid request body');
    });

    it('does not mislabel a mid-loop DB/queue error as "Invalid request body"', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
        ]);
        mockCreateJob.mockRejectedValueOnce(new Error('db down'));

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });

        await expect(forceSync(req as never)).rejects.toThrow('db down');
    });

    it('requires admin role', async () => {
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'MEMBER'));

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);

        expect(res.status).toBe(403);
        expect(mockSyncEventFindFirst).not.toHaveBeenCalled();
        expect(mockTicketExternalLinkFindMany).not.toHaveBeenCalled();
        expect(mockCreateJob).not.toHaveBeenCalled();
    });
});
