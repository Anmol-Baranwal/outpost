import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/passwords.js';

/**
 * Tests for the credentials auth flow logic.
 *
 * Rather than importing the NextAuth config (which has Next.js and Prisma
 * runtime dependencies), we test the core validation logic directly:
 * given a stored hash, does the password check pass or fail correctly?
 */

describe('credentials auth validation', () => {
    // Simulate the exact flow that the CredentialsProvider authorize function uses
    async function simulateAuthorize(
        inputEmail: string,
        inputPassword: string,
        dbMembers: Array<{ email: string; passwordHash: string | null; id: string; name: string; role: string }>
    ) {
        if (!inputEmail || !inputPassword) return null;

        const member = dbMembers.find((m) => m.email === inputEmail) ?? null;
        if (!member || !member.passwordHash) return null;

        const valid = await verifyPassword(inputPassword, member.passwordHash);
        if (!valid) return null;

        return { id: member.id, name: member.name, email: member.email, role: member.role };
    }

    let adminHash: string;
    let dbMembers: Array<{ email: string; passwordHash: string | null; id: string; name: string; role: string }>;

    beforeEach(async () => {
        adminHash = await hashPassword('outpost-dev');
        dbMembers = [
            { id: 'cm1', email: 'admin@test.com', passwordHash: adminHash, name: 'Admin', role: 'ADMIN' },
            { id: 'cm2', email: 'nopw@test.com', passwordHash: null, name: 'No Password', role: 'MEMBER' },
        ];
    });

    it('validates correct password and returns user', async () => {
        const result = await simulateAuthorize('admin@test.com', 'outpost-dev', dbMembers);
        expect(result).toEqual({
            id: 'cm1',
            name: 'Admin',
            email: 'admin@test.com',
            role: 'ADMIN',
        });
    });

    it('rejects wrong password', async () => {
        const result = await simulateAuthorize('admin@test.com', 'wrong-password', dbMembers);
        expect(result).toBeNull();
    });

    it('rejects unknown email', async () => {
        const result = await simulateAuthorize('nobody@test.com', 'outpost-dev', dbMembers);
        expect(result).toBeNull();
    });

    it('rejects user with no password hash set', async () => {
        const result = await simulateAuthorize('nopw@test.com', 'anything', dbMembers);
        expect(result).toBeNull();
    });

    it('rejects empty credentials', async () => {
        expect(await simulateAuthorize('', 'password', dbMembers)).toBeNull();
        expect(await simulateAuthorize('admin@test.com', '', dbMembers)).toBeNull();
    });
});
