import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockAgentFindMany = vi.fn();
const mockAgentFindUnique = vi.fn();
const mockAgentCreate = vi.fn();
const mockAgentUpdate = vi.fn();
const mockAgentDelete = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        agent: {
            findMany: (...args: unknown[]) => mockAgentFindMany(...args),
            findUnique: (...args: unknown[]) => mockAgentFindUnique(...args),
            create: (...args: unknown[]) => mockAgentCreate(...args),
            update: (...args: unknown[]) => mockAgentUpdate(...args),
            delete: (...args: unknown[]) => mockAgentDelete(...args),
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

// Import after mocks
import { GET, POST } from '@/app/api/agents/route';
import { GET as GET_BY_ID, PATCH, DELETE } from '@/app/api/agents/[id]/route';
import { POST as RUN } from '@/app/api/agents/[id]/run/route';

import type { AgentFormData } from '@/components/agents/agent-form';
import { validateAgentForm } from '@/components/agents/agent-form';

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

const MOCK_AGENT = {
    id: 'agent-1',
    name: 'Auto-Classifier',
    description: 'Runs AI classification',
    config: { triggerType: 'interval', intervalMinutes: 15, actionType: 'classify_tickets' },
    lastRun: new Date('2026-04-15T08:30:00Z'),
    status: 'ACTIVE',
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-04-15'),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function userSession(memberId = 'tm-1', role = 'MEMBER') {
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

// ─── Agent API Route Tests ──────────────────────────────────────────────────

describe('GET /api/agents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns all agents', async () => {
        mockAgentFindMany.mockResolvedValue([MOCK_AGENT]);

        const req = makeGetRequest('http://localhost:3000/api/agents');
        const res = await GET(req as never);
        const body = await res.json();

        expect(body.agents).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('returns empty array when no agents exist', async () => {
        mockAgentFindMany.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/agents');
        const res = await GET(req as never);
        const body = await res.json();

        expect(body.agents).toHaveLength(0);
    });

    it('passes search filter', async () => {
        mockAgentFindMany.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/agents?search=classifier');
        await GET(req as never);

        expect(mockAgentFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    OR: expect.arrayContaining([
                        expect.objectContaining({ name: expect.objectContaining({ contains: 'classifier' }) }),
                    ]),
                }),
            }),
        );
    });
});

describe('POST /api/agents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('creates an agent', async () => {
        mockAgentCreate.mockResolvedValue({ ...MOCK_AGENT, id: 'agent-new' });

        const req = makeJsonRequest('http://localhost:3000/api/agents', {
            name: 'New Agent',
            config: { triggerType: 'manual', actionType: 'classify_tickets' },
        });
        const res = await POST(req as never);

        expect(res.status).toBe(201);
        expect(mockAgentCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects when name is missing', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/agents', {
            config: { triggerType: 'manual', actionType: 'classify_tickets' },
        });
        const res = await POST(req as never);

        expect(res.status).toBe(400);
    });

    it('rejects invalid triggerType', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/agents', {
            name: 'Test',
            config: { triggerType: 'invalid', actionType: 'classify_tickets' },
        });
        const res = await POST(req as never);

        expect(res.status).toBe(400);
    });
});

describe('GET /api/agents/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns agent by ID', async () => {
        mockAgentFindUnique.mockResolvedValue(MOCK_AGENT);

        const req = makeGetRequest('http://localhost:3000/api/agents/agent-1');
        const res = await GET_BY_ID(req as never, { params: Promise.resolve({ id: 'agent-1' }) });
        const body = await res.json();

        expect(body.name).toBe('Auto-Classifier');
    });

    it('returns 404 for non-existent agent', async () => {
        mockAgentFindUnique.mockResolvedValue(null);

        const req = makeGetRequest('http://localhost:3000/api/agents/nope');
        const res = await GET_BY_ID(req as never, { params: Promise.resolve({ id: 'nope' }) });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/agents/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('deletes an agent', async () => {
        mockAgentFindUnique.mockResolvedValue(MOCK_AGENT);
        mockAgentDelete.mockResolvedValue(MOCK_AGENT);

        const req = new NextRequest('http://localhost:3000/api/agents/agent-1', { method: 'DELETE' });
        const res = await DELETE(req as never, { params: Promise.resolve({ id: 'agent-1' }) });
        const body = await res.json();

        expect(body.deleted).toBe(true);
        expect(mockAgentDelete).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for non-existent agent', async () => {
        mockAgentFindUnique.mockResolvedValue(null);

        const req = new NextRequest('http://localhost:3000/api/agents/nope', { method: 'DELETE' });
        const res = await DELETE(req as never, { params: Promise.resolve({ id: 'nope' }) });

        expect(res.status).toBe(404);
    });
});

describe('POST /api/agents/[id]/run', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'ADMIN'));
    });

    it('triggers a run and updates lastRun', async () => {
        mockAgentFindUnique.mockResolvedValue(MOCK_AGENT);
        mockAgentUpdate.mockResolvedValue({ ...MOCK_AGENT, lastRun: new Date() });

        const req = makeJsonRequest('http://localhost:3000/api/agents/agent-1/run', {});
        const res = await RUN(req as never, { params: Promise.resolve({ id: 'agent-1' }) });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body.status).toBe('queued');
        expect(mockAgentUpdate).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for non-existent agent', async () => {
        mockAgentFindUnique.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/agents/nope/run', {});
        const res = await RUN(req as never, { params: Promise.resolve({ id: 'nope' }) });

        expect(res.status).toBe(404);
    });
});

// ─── Agent Form Validation Tests ────────────────────────────────────────────

describe('Agent form validation', () => {
    const validData: AgentFormData = {
        name: 'Test Agent',
        description: 'A test agent',
        config: {
            triggerType: 'manual',
            actionType: 'classify_tickets',
        },
    };

    it('passes for valid manual trigger data', () => {
        const errors = validateAgentForm(validData);
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('fails when name is empty', () => {
        const errors = validateAgentForm({ ...validData, name: '' });
        expect(errors.name).toBe('Name is required');
    });

    it('fails when name is whitespace only', () => {
        const errors = validateAgentForm({ ...validData, name: '   ' });
        expect(errors.name).toBe('Name is required');
    });

    it('fails when interval is missing for interval trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'interval', actionType: 'classify_tickets', intervalMinutes: 0 },
        });
        expect(errors.intervalMinutes).toBeTruthy();
    });

    it('fails when cron expression is empty for cron trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'cron', actionType: 'classify_tickets', cronExpression: '' },
        });
        expect(errors.cronExpression).toBeTruthy();
    });

    it('fails when webhook URL is missing for custom_webhook action', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'manual', actionType: 'custom_webhook' },
        });
        expect(errors.webhookUrl).toBeTruthy();
    });

    it('fails when webhook URL is not valid', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'manual', actionType: 'custom_webhook', webhookUrl: 'not-a-url' },
        });
        expect(errors.webhookUrl).toBe('Must be a valid URL');
    });

    it('passes when webhook URL is valid', () => {
        const errors = validateAgentForm({
            ...validData,
            config: {
                triggerType: 'manual',
                actionType: 'custom_webhook',
                webhookUrl: 'https://hooks.example.com/test',
            },
        });
        expect(errors.webhookUrl).toBeUndefined();
    });

    it('passes for valid interval trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'interval', actionType: 'classify_tickets', intervalMinutes: 15 },
        });
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('passes for valid cron trigger', () => {
        const errors = validateAgentForm({
            ...validData,
            config: { triggerType: 'cron', actionType: 'check_sla', cronExpression: '0 * * * *' },
        });
        expect(Object.keys(errors)).toHaveLength(0);
    });
});
