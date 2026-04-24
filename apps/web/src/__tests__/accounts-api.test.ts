import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockAccountFindMany = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockAccountCreate = vi.fn();
const mockAccountUpdate = vi.fn();
const mockTicketGroupBy = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        account: {
            findMany: (...args: unknown[]) => mockAccountFindMany(...args),
            findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
            create: (...args: unknown[]) => mockAccountCreate(...args),
            update: (...args: unknown[]) => mockAccountUpdate(...args),
        },
        ticket: {
            groupBy: (...args: unknown[]) => mockTicketGroupBy(...args),
        },
    },
}));

// Import after mocks
import { GET, POST } from '@/app/api/accounts/route';
import { GET as GET_BY_ID, PATCH } from '@/app/api/accounts/[id]/route';

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

const MOCK_ACCOUNT = {
    id: 'acc-1',
    name: 'Acme Corp',
    domain: 'acme.com',
    owner: 'Alice',
    sentiment: 'HAPPY',
    engagement: 'HIGH',
    acv: 120000,
    closeDate: new Date('2025-06-15'),
    createdAt: new Date('2024-09-15'),
    updatedAt: new Date('2025-04-14'),
    _count: { tickets: 3 },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/accounts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns accounts with ticket counts', async () => {
        mockAccountFindMany.mockResolvedValue([MOCK_ACCOUNT]);
        mockTicketGroupBy.mockResolvedValue([
            { accountId: 'acc-1', status: 'OPEN', _count: 2 },
            { accountId: 'acc-1', status: 'IN_PROGRESS', _count: 1 },
        ]);

        const req = makeGetRequest('http://localhost:3000/api/accounts');
        const res = await GET(req as never);
        const body = await res.json();

        expect(body.accounts).toHaveLength(1);
        expect(body.accounts[0].openTickets).toBe(2);
        expect(body.accounts[0].inProgressTickets).toBe(1);
        expect(body.accounts[0].closedTickets).toBe(0);
        expect(body.total).toBe(1);
    });

    it('returns empty array when no accounts exist', async () => {
        mockAccountFindMany.mockResolvedValue([]);
        mockTicketGroupBy.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/accounts');
        const res = await GET(req as never);
        const body = await res.json();

        expect(body.accounts).toHaveLength(0);
        expect(body.total).toBe(0);
    });

    it('passes search filter to Prisma', async () => {
        mockAccountFindMany.mockResolvedValue([]);
        mockTicketGroupBy.mockResolvedValue([]);

        const req = makeGetRequest('http://localhost:3000/api/accounts?search=acme');
        await GET(req as never);

        expect(mockAccountFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    OR: expect.arrayContaining([
                        expect.objectContaining({ name: expect.objectContaining({ contains: 'acme' }) }),
                    ]),
                }),
            }),
        );
    });
});

describe('POST /api/accounts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates an account', async () => {
        const created = { ...MOCK_ACCOUNT, id: 'acc-new' };
        mockAccountCreate.mockResolvedValue(created);

        const req = makeJsonRequest('http://localhost:3000/api/accounts', {
            name: 'New Corp',
            domain: 'new.com',
        });
        const res = await POST(req as never);
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(body.openTickets).toBe(0);
        expect(mockAccountCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects when name is missing', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/accounts', {});
        const res = await POST(req as never);

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('name is required');
    });
});

describe('GET /api/accounts/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns account with ticket counts', async () => {
        mockAccountFindUnique.mockResolvedValue({
            ...MOCK_ACCOUNT,
            users: [],
            tickets: [
                { id: 't1', status: 'OPEN' },
                { id: 't2', status: 'CLOSED' },
            ],
        });

        const req = makeGetRequest('http://localhost:3000/api/accounts/acc-1');
        const res = await GET_BY_ID(req as never, { params: Promise.resolve({ id: 'acc-1' }) });
        const body = await res.json();

        expect(body.openTickets).toBe(1);
        expect(body.closedTickets).toBe(1);
    });

    it('returns 404 for non-existent account', async () => {
        mockAccountFindUnique.mockResolvedValue(null);

        const req = makeGetRequest('http://localhost:3000/api/accounts/nope');
        const res = await GET_BY_ID(req as never, { params: Promise.resolve({ id: 'nope' }) });

        expect(res.status).toBe(404);
    });
});

describe('PATCH /api/accounts/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates account fields', async () => {
        mockAccountFindUnique.mockResolvedValue(MOCK_ACCOUNT);
        mockAccountUpdate.mockResolvedValue({ ...MOCK_ACCOUNT, owner: 'Bob' });

        const req = makeJsonRequest('http://localhost:3000/api/accounts/acc-1', { owner: 'Bob' }, 'PATCH');
        const res = await PATCH(req as never, { params: Promise.resolve({ id: 'acc-1' }) });
        const body = await res.json();

        expect(body.owner).toBe('Bob');
        expect(mockAccountUpdate).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for non-existent account', async () => {
        mockAccountFindUnique.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/accounts/nope', { owner: 'Bob' }, 'PATCH');
        const res = await PATCH(req as never, { params: Promise.resolve({ id: 'nope' }) });

        expect(res.status).toBe(404);
    });

    it('returns 400 when no valid fields provided', async () => {
        mockAccountFindUnique.mockResolvedValue(MOCK_ACCOUNT);

        const req = makeJsonRequest('http://localhost:3000/api/accounts/acc-1', { invalid: 'field' }, 'PATCH');
        const res = await PATCH(req as never, { params: Promise.resolve({ id: 'acc-1' }) });

        expect(res.status).toBe(400);
    });
});
