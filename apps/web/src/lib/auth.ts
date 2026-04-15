import type { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
    providers: [
        GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID ?? '',
            clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
        }),
    ],
    callbacks: {
        async session({ session, token }) {
            if (session.user && token.sub) {
                // Extend session with user ID
                (session.user as Record<string, unknown>).id = token.sub;
            }
            return session;
        },
    },
    pages: {
        signIn: '/auth/signin',
    },
};
