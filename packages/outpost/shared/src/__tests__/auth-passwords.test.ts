import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/passwords.js';

describe('hashPassword', () => {
    it('returns a bcrypt hash string', async () => {
        const hash = await hashPassword('test-password');
        // bcrypt hashes start with $2b$ (or $2a$)
        expect(hash).toMatch(/^\$2[aby]\$/);
    });

    it('produces different hashes for the same input (salt)', async () => {
        const hash1 = await hashPassword('same-password');
        const hash2 = await hashPassword('same-password');
        expect(hash1).not.toBe(hash2);
    });
});

describe('verifyPassword', () => {
    it('returns true for matching password', async () => {
        const hash = await hashPassword('correct-password');
        const result = await verifyPassword('correct-password', hash);
        expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
        const hash = await hashPassword('correct-password');
        const result = await verifyPassword('wrong-password', hash);
        expect(result).toBe(false);
    });

    it('round-trips with various passwords', async () => {
        const passwords = ['', 'short', 'a-longer-passphrase-with-special-chars!@#$%', '   spaces   '];
        for (const pw of passwords) {
            const hash = await hashPassword(pw);
            expect(await verifyPassword(pw, hash)).toBe(true);
            expect(await verifyPassword(pw + 'x', hash)).toBe(false);
        }
    });
});
