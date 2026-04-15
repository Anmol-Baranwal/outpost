import type { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';

const ALLOWED_ORG = process.env.GITHUB_ALLOWED_ORG ?? 'CopilotKit';
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? '';

export const authOptions: NextAuthOptions = {
    providers: [
        GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID ?? '',
            clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
            authorization: {
                params: {
                    scope: 'read:user user:email read:org',
                },
            },
        }),
    ],
    callbacks: {
        async signIn({ account, profile }) {
            // If an email domain restriction is configured, check it
            if (ALLOWED_EMAIL_DOMAIN && profile?.email) {
                if (profile.email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
                    return true;
                }
            }

            // Check GitHub org membership if configured
            if (ALLOWED_ORG && account?.access_token) {
                try {
                    const res = await fetch(
                        `https://api.github.com/orgs/${ALLOWED_ORG}/members/${(profile as Record<string, unknown>).login}`,
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

            // If neither restriction is set, allow all GitHub users
            if (!ALLOWED_ORG && !ALLOWED_EMAIL_DOMAIN) {
                return true;
            }

            return '/login?error=AccessDenied';
        },
        async session({ session, token }) {
            if (session.user && token.sub) {
                (session.user as Record<string, unknown>).id = token.sub;
            }
            if (session.user && token.picture) {
                session.user.image = token.picture as string;
            }
            return session;
        },
        async jwt({ token, profile }) {
            if (profile) {
                token.picture = (profile as Record<string, unknown>).avatar_url as string;
            }
            return token;
        },
    },
    pages: {
        signIn: '/login',
        error: '/login',
    },
    secret: process.env.NEXTAUTH_SECRET,
};
