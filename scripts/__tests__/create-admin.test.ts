import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock PrismaClient ──────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        teamMember: {
            create: vi.fn().mockResolvedValue({
                id: 'cuid-test',
                name: 'Test Admin',
                email: 'admin@example.com',
                role: 'ADMIN',
            }),
        },
        $disconnect: vi.fn().mockResolvedValue(undefined),
    };
}

vi.mock('@prisma/client', () => ({
    PrismaClient: vi.fn().mockImplementation(() => makePrismaMock()),
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    hashPassword: vi.fn().mockResolvedValue('hashed-password-mock'),
}));

import { createAdmin } from '../create-admin.js';

describe('create-admin CLI', () => {
    let prismaMock: ReturnType<typeof makePrismaMock>;

    beforeEach(() => {
        prismaMock = makePrismaMock();
    });

    it('creates an admin team member with hashed password', async () => {
        await createAdmin(
            { name: 'Test Admin', email: 'admin@example.com', password: 'securepass123' },
            prismaMock,
        );

        expect(prismaMock.teamMember.create).toHaveBeenCalledWith({
            data: {
                name: 'Test Admin',
                email: 'admin@example.com',
                passwordHash: 'hashed-password-mock',
                role: 'ADMIN',
            },
        });
    });

    it('normalizes email to lowercase and trims name', async () => {
        await createAdmin(
            { name: '  Padded Name  ', email: 'UPPER@Example.COM', password: 'securepass123' },
            prismaMock,
        );

        expect(prismaMock.teamMember.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: 'Padded Name',
                email: 'upper@example.com',
            }),
        });
    });

    it('throws on empty name', async () => {
        await expect(
            createAdmin({ name: '', email: 'a@b.com', password: 'securepass123' }, prismaMock),
        ).rejects.toThrow('Name is required');
    });

    it('throws on invalid email', async () => {
        await expect(
            createAdmin({ name: 'Test', email: 'not-valid', password: 'securepass123' }, prismaMock),
        ).rejects.toThrow('valid email');
    });

    it('throws on short password', async () => {
        await expect(
            createAdmin({ name: 'Test', email: 'a@b.com', password: 'short' }, prismaMock),
        ).rejects.toThrow('8 characters');
    });
});
