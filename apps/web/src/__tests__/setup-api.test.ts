import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockCount = vi.fn();
const mockCreate = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        teamMember: {
            count: () => mockCount(),
            create: (args: unknown) => mockCreate(args),
        },
    },
}));

// ─── Mock hashPassword ──────────────────────────────────────────────────────

vi.mock('@copilotkit/outpost/shared', () => ({
    hashPassword: vi.fn().mockResolvedValue('hashed-password-123'),
}));

// Import after mocks
import { POST } from '@/app/api/setup/route';

function makeRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost:3000/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/setup', () => {
    beforeEach(() => {
        mockCount.mockReset();
        mockCreate.mockReset();
    });

    it('creates an admin when no team members exist', async () => {
        mockCount.mockResolvedValue(0);
        mockCreate.mockResolvedValue({
            id: 'cuid-123',
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'ADMIN',
            createdAt: new Date('2025-01-01'),
        });

        const res = await POST(makeRequest({
            name: 'Admin User',
            email: 'admin@example.com',
            password: 'securepass123',
            confirmPassword: 'securepass123',
        }));

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe('Admin User');
        expect(body.email).toBe('admin@example.com');
        expect(body.role).toBe('ADMIN');
        expect(body.passwordHash).toBeUndefined();

        expect(mockCreate).toHaveBeenCalledWith({
            data: {
                name: 'Admin User',
                email: 'admin@example.com',
                passwordHash: 'hashed-password-123',
                role: 'ADMIN',
            },
        });
    });

    it('returns 403 when team members already exist', async () => {
        mockCount.mockResolvedValue(1);

        const res = await POST(makeRequest({
            name: 'Hacker',
            email: 'hacker@evil.com',
            password: 'password123',
            confirmPassword: 'password123',
        }));

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toContain('already exists');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('validates required fields', async () => {
        mockCount.mockResolvedValue(0);

        const res = await POST(makeRequest({}));

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('Name'),
                expect.stringContaining('Email'),
                expect.stringContaining('Password'),
            ]),
        );
    });

    it('validates email format', async () => {
        mockCount.mockResolvedValue(0);

        const res = await POST(makeRequest({
            name: 'Test',
            email: 'not-an-email',
            password: 'password123',
            confirmPassword: 'password123',
        }));

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('valid email'),
            ]),
        );
    });

    it('validates password length', async () => {
        mockCount.mockResolvedValue(0);

        const res = await POST(makeRequest({
            name: 'Test',
            email: 'test@example.com',
            password: 'short',
            confirmPassword: 'short',
        }));

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('8 characters'),
            ]),
        );
    });

    it('validates passwords match', async () => {
        mockCount.mockResolvedValue(0);

        const res = await POST(makeRequest({
            name: 'Test',
            email: 'test@example.com',
            password: 'password123',
            confirmPassword: 'different456',
        }));

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('do not match'),
            ]),
        );
    });
});
