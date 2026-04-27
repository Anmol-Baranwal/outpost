import type { NextAuthOptions, Profile } from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GithubProvider from 'next-auth/providers/github';
import { prisma } from '@copilotkit/outpost/db';
import { verifyPassword } from '@copilotkit/outpost/shared';

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? 'credentials';

// ─── Provider Factories ────────────────────────────────────────────────────

function buildCredentialsProvider() {
    return CredentialsProvider({
        name: 'Credentials',
        credentials: {
            email: { label: 'Email', type: 'email' },
            password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
            if (!credentials?.email || !credentials?.password) {
                return null;
            }

            const member = await prisma.teamMember.findUnique({
                where: { email: credentials.email },
            });

            if (!member || !member.passwordHash) {
                return null;
            }

            const valid = await verifyPassword(credentials.password, member.passwordHash);
            if (!valid) {
                return null;
            }

            return {
                id: member.id,
                name: member.name,
                email: member.email,
                image: member.avatarUrl,
                role: member.role,
            };
        },
    });
}

function buildGithubProvider() {
    return GithubProvider({
        clientId: process.env.GITHUB_CLIENT_ID ?? '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
        authorization: {
            params: {
                scope: 'read:user user:email read:org',
            },
        },
    });
}

function buildOidcProvider(): OAuthConfig<Profile> {
    return {
        id: 'oidc',
        name: 'SSO',
        type: 'oauth',
        wellKnown: `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`,
        clientId: process.env.OIDC_CLIENT_ID ?? '',
        clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
        authorization: { params: { scope: 'openid email profile' } },
        idToken: true,
        checks: ['pkce', 'state'],
        profile(profile) {
            return {
                id: profile.sub ?? '',
                name: (profile.name ?? profile.email ?? '') as string,
                email: profile.email as string,
                image: ((profile as Record<string, unknown>).picture ?? profile.image ?? null) as
                    | string
                    | null,
            };
        },
    };
}

// ─── GitHub org gating (only used when AUTH_PROVIDER=github) ───────────────

const ALLOWED_ORG = process.env.GITHUB_ALLOWED_ORG ?? 'CopilotKit';
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? '';

async function githubSignInGate(
    account: Record<string, unknown> | null,
    profile?: Record<string, unknown>,
): Promise<boolean | string> {
    if (ALLOWED_EMAIL_DOMAIN && profile?.email) {
        if ((profile.email as string).endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
            return true;
        }
    }

    if (ALLOWED_ORG && account?.access_token) {
        try {
            const res = await fetch(
                `https://api.github.com/orgs/${ALLOWED_ORG}/members/${profile?.login}`,
                {
                    headers: {
                        Authorization: `Bearer ${account.access_token}`,
                    },
                },
            );
            if (res.status === 204) {
                return true;
            }
        } catch {
            // Fall through to deny
        }
    }

    if (!ALLOWED_ORG && !ALLOWED_EMAIL_DOMAIN) {
        return true;
    }

    return '/login?error=AccessDenied';
}

// ─── OIDC domain gating + auto-provisioning ───────────────────────────────

async function oidcSignInGate(
    user: { id?: string; name?: string | null; email?: string | null; image?: string | null },
    profile?: Record<string, unknown>,
): Promise<boolean | string> {
    const email = ((user.email ?? profile?.email ?? '') as string).toLowerCase();

    if (!email) {
        return '/login?error=AccessDenied';
    }

    if (ALLOWED_EMAIL_DOMAIN) {
        if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`)) {
            return '/login?error=AccessDenied';
        }
    }

    const name = (user.name ?? profile?.name ?? email.split('@')[0]) as string;
    try {
        await prisma.teamMember.upsert({
            where: { email },
            create: {
                name,
                email,
                role: 'MEMBER',
                status: 'ACTIVE',
                joinedAt: new Date(),
                avatarUrl: (user.image ?? null) as string | null,
            },
            update: {
                name,
                avatarUrl: (user.image ?? null) as string | null,
            },
        });
    } catch (error) {
        console.error(
            '[OIDC Auth] Auto-provisioning failed:',
            error instanceof Error ? error.message : String(error),
        );
    }

    return true;
}

// ─── Assemble Auth Options ─────────────────────────────────────────────────

function buildAuthOptions(): NextAuthOptions {
    const providers = (() => {
        switch (AUTH_PROVIDER) {
            case 'credentials':
                return [buildCredentialsProvider()];
            case 'github':
                return [buildGithubProvider()];
            case 'oidc':
                return [buildOidcProvider()];
            default:
                throw new Error(`Unknown AUTH_PROVIDER: ${AUTH_PROVIDER}`);
        }
    })();

    return {
        providers,
        session: {
            strategy: 'jwt',
        },
        callbacks: {
            async signIn({ user, account, profile }) {
                if (AUTH_PROVIDER === 'github') {
                    return githubSignInGate(
                        account as unknown as Record<string, unknown> | null,
                        profile as unknown as Record<string, unknown> | undefined,
                    );
                }
                if (AUTH_PROVIDER === 'oidc') {
                    return oidcSignInGate(
                        user,
                        profile as unknown as Record<string, unknown> | undefined,
                    );
                }
                return true;
            },
            async jwt({ token, user, account }) {
                if (user) {
                    if (account?.provider === 'oidc' && token.email) {
                        try {
                            const member = await prisma.teamMember.findUnique({
                                where: { email: token.email },
                                select: { id: true, role: true },
                            });
                            token.memberId = member?.id ?? user.id;
                            token.role = member?.role ?? 'MEMBER';
                        } catch (error) {
                            console.error(
                                '[OIDC Auth] Failed to resolve TeamMember for JWT:',
                                error instanceof Error ? error.message : String(error),
                            );
                            token.memberId = user.id;
                            token.role = 'MEMBER';
                        }
                    } else {
                        token.role = (user as unknown as Record<string, unknown>).role ?? 'MEMBER';
                        token.memberId = user.id;
                    }
                }
                return token;
            },
            async session({ session, token }) {
                if (session.user) {
                    (session.user as Record<string, unknown>).id = token.memberId;
                    (session.user as Record<string, unknown>).role = token.role;
                    (session.user as Record<string, unknown>).memberId = token.memberId;
                }
                return session;
            },
        },
        pages: {
            signIn: '/login',
            error: '/login',
        },
        secret: process.env.NEXTAUTH_SECRET,
    };
}

export const authOptions = buildAuthOptions();
