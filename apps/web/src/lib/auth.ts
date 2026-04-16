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
                image: (profile.image ?? null) as string | null,
            };
        },
    };
}

// ─── GitHub org gating (only used when AUTH_PROVIDER=github) ───────────────

const ALLOWED_ORG = process.env.GITHUB_ALLOWED_ORG ?? 'CopilotKit';
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? '';

async function githubSignInGate(account: Record<string, unknown> | null, profile?: Record<string, unknown>): Promise<boolean | string> {
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
                }
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
            async signIn({ account, profile }) {
                if (AUTH_PROVIDER === 'github') {
                    return githubSignInGate(
                        account as unknown as Record<string, unknown> | null,
                        profile as unknown as Record<string, unknown> | undefined
                    );
                }
                return true;
            },
            async jwt({ token, user }) {
                // On initial sign-in, persist role and member ID into the JWT
                if (user) {
                    token.role = (user as unknown as Record<string, unknown>).role ?? 'SUPPORT';
                    token.memberId = user.id;
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
