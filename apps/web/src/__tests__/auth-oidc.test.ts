import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockTeamMemberFindUnique = vi.fn();
const mockTeamMemberUpsert = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        teamMember: {
            findUnique: mockTeamMemberFindUnique,
            upsert: mockTeamMemberUpsert,
        },
    },
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    verifyPassword: vi.fn(),
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OIDC auth', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AUTH_PROVIDER = 'oidc';
        process.env.OIDC_ISSUER = 'https://accounts.google.com';
        process.env.OIDC_CLIENT_ID = 'test-client-id';
        process.env.OIDC_CLIENT_SECRET = 'test-client-secret';
        process.env.ALLOWED_EMAIL_DOMAIN = 'copilotkit.ai';
        process.env.NEXTAUTH_SECRET = 'test-secret';
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    describe('signIn callback — domain restriction', () => {
        it('allows sign-in for matching email domain', async () => {
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-1', name: 'Alice', email: 'alice@copilotkit.ai' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-1',
                } as never,
                profile: {
                    sub: 'oidc-sub-1',
                    email: 'alice@copilotkit.ai',
                    name: 'Alice',
                } as never,
                credentials: undefined,
            });

            expect(result).toBe(true);
        });

        it('rejects sign-in for non-matching email domain', async () => {
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-2', name: 'Eve', email: 'eve@evil.com' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-2',
                } as never,
                profile: { sub: 'oidc-sub-2', email: 'eve@evil.com', name: 'Eve' } as never,
                credentials: undefined,
            });

            expect(result).toBe('/login?error=AccessDenied');
        });

        it('rejects sign-in when email is missing', async () => {
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-3', name: 'NoEmail' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-3',
                } as never,
                profile: { sub: 'oidc-sub-3', name: 'NoEmail' } as never,
                credentials: undefined,
            });

            expect(result).toBe('/login?error=AccessDenied');
        });

        it('allows any email when ALLOWED_EMAIL_DOMAIN is empty', async () => {
            process.env.ALLOWED_EMAIL_DOMAIN = '';
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-4', name: 'Anyone', email: 'anyone@anywhere.com' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-4',
                } as never,
                profile: {
                    sub: 'oidc-sub-4',
                    email: 'anyone@anywhere.com',
                    name: 'Anyone',
                } as never,
                credentials: undefined,
            });

            expect(result).toBe(true);
        });

        it('rejects sign-in when email is missing and ALLOWED_EMAIL_DOMAIN is empty', async () => {
            process.env.ALLOWED_EMAIL_DOMAIN = '';
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-5', name: 'Ghost' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-5',
                } as never,
                profile: { sub: 'oidc-sub-5', name: 'Ghost' } as never,
                credentials: undefined,
            });

            expect(result).toBe('/login?error=AccessDenied');
        });

        it('allows sign-in with case-insensitive domain matching', async () => {
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-6', name: 'Alice', email: 'alice@CopilotKit.AI' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-6',
                } as never,
                profile: {
                    sub: 'oidc-sub-6',
                    email: 'alice@CopilotKit.AI',
                    name: 'Alice',
                } as never,
                credentials: undefined,
            });

            expect(result).toBe(true);
        });

        it('rejects email with domain as substring but not exact match', async () => {
            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-evil', name: 'Evil', email: 'evil@notcopilotkit.ai' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-evil',
                } as never,
                profile: { sub: 'oidc-evil', email: 'evil@notcopilotkit.ai' } as never,
                credentials: undefined,
            });
            expect(result).toBe('/login?error=AccessDenied');
        });
    });

    describe('signIn callback — auto-provisioning', () => {
        it('creates TeamMember on first OIDC login', async () => {
            mockTeamMemberFindUnique.mockResolvedValue(null);
            mockTeamMemberUpsert.mockResolvedValue({
                id: 'member-new',
                name: 'Alice',
                email: 'alice@copilotkit.ai',
                role: 'MEMBER',
            });

            const { authOptions } = await import('../lib/auth.js');
            await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-1', name: 'Alice', email: 'alice@copilotkit.ai' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-1',
                } as never,
                profile: {
                    sub: 'oidc-sub-1',
                    email: 'alice@copilotkit.ai',
                    name: 'Alice',
                } as never,
                credentials: undefined,
            });

            expect(mockTeamMemberUpsert).toHaveBeenCalledWith({
                where: { email: 'alice@copilotkit.ai' },
                create: expect.objectContaining({
                    name: 'Alice',
                    email: 'alice@copilotkit.ai',
                    role: 'MEMBER',
                    status: 'ACTIVE',
                }),
                update: expect.objectContaining({
                    name: 'Alice',
                }),
            });
        });

        it('allows sign-in even when upsert fails', async () => {
            mockTeamMemberUpsert.mockRejectedValue(new Error('DB timeout'));

            const { authOptions } = await import('../lib/auth.js');
            const result = await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-1', name: 'Alice', email: 'alice@copilotkit.ai' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-1',
                } as never,
                profile: {
                    sub: 'oidc-sub-1',
                    email: 'alice@copilotkit.ai',
                    name: 'Alice',
                } as never,
                credentials: undefined,
            });

            expect(result).toBe(true);
            expect(mockTeamMemberUpsert).toHaveBeenCalled();
        });

        it('uses email local-part as name when user.name and profile.name are missing', async () => {
            mockTeamMemberUpsert.mockResolvedValue({ id: 'member-new' });
            const { authOptions } = await import('../lib/auth.js');
            await authOptions.callbacks!.signIn!({
                user: { id: 'oidc-sub-7', email: 'bob@copilotkit.ai' },
                account: {
                    provider: 'oidc',
                    type: 'oauth',
                    providerAccountId: 'oidc-sub-7',
                } as never,
                profile: { sub: 'oidc-sub-7', email: 'bob@copilotkit.ai' } as never,
                credentials: undefined,
            });

            expect(mockTeamMemberUpsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ name: 'bob' }),
                }),
            );
        });
    });

    describe('jwt callback — OIDC identity resolution', () => {
        it('resolves TeamMember ID and role for OIDC users', async () => {
            mockTeamMemberFindUnique.mockResolvedValue({
                id: 'member-1',
                role: 'ADMIN',
            });

            const { authOptions } = await import('../lib/auth.js');
            const token = await authOptions.callbacks!.jwt!({
                token: { sub: 'oidc-sub-1', email: 'alice@copilotkit.ai' },
                user: { id: 'oidc-sub-1', name: 'Alice', email: 'alice@copilotkit.ai' },
                account: { provider: 'oidc', type: 'oauth' } as never,
                trigger: 'signIn',
            } as never);

            expect(token.memberId).toBe('member-1');
            expect(token.role).toBe('ADMIN');
        });

        it('falls back to MEMBER role when TeamMember not found', async () => {
            mockTeamMemberFindUnique.mockResolvedValue(null);

            const { authOptions } = await import('../lib/auth.js');
            const token = await authOptions.callbacks!.jwt!({
                token: { sub: 'oidc-sub-1', email: 'alice@copilotkit.ai' },
                user: { id: 'oidc-sub-1', name: 'Alice', email: 'alice@copilotkit.ai' },
                account: { provider: 'oidc', type: 'oauth' } as never,
                trigger: 'signIn',
            } as never);

            expect(token.role).toBe('MEMBER');
        });

        it('falls back to user.id and MEMBER when findUnique throws', async () => {
            mockTeamMemberFindUnique.mockRejectedValue(new Error('connection refused'));

            const { authOptions } = await import('../lib/auth.js');
            const token = await authOptions.callbacks!.jwt!({
                token: { sub: 'oidc-sub-1', email: 'alice@copilotkit.ai' },
                user: { id: 'oidc-sub-1', name: 'Alice', email: 'alice@copilotkit.ai' },
                account: { provider: 'oidc', type: 'oauth' } as never,
                trigger: 'signIn',
            } as never);

            expect(token.memberId).toBe('oidc-sub-1');
            expect(token.role).toBe('MEMBER');
        });

        it('falls back to MEMBER for OIDC user when token has no email', async () => {
            const { authOptions } = await import('../lib/auth.js');
            const token = await authOptions.callbacks!.jwt!({
                token: { sub: 'oidc-sub-1' },
                user: { id: 'oidc-sub-1', name: 'Alice' },
                account: { provider: 'oidc', type: 'oauth' } as never,
                trigger: 'signIn',
            } as never);

            expect(token.memberId).toBe('oidc-sub-1');
            expect(token.role).toBe('MEMBER');
            expect(mockTeamMemberFindUnique).not.toHaveBeenCalled();
        });
    });
});
