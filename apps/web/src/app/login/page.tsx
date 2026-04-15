'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Mountain, Github } from 'lucide-react';
import { Suspense } from 'react';

function LoginContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-sm space-y-8 px-4">
                <div className="text-center">
                    <div className="flex justify-center">
                        <Mountain className="h-12 w-12 text-primary" />
                    </div>
                    <h1 className="mt-4 text-3xl font-bold text-foreground">Outpost</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        AI-Powered Support Operations
                    </p>
                </div>

                {error === 'AccessDenied' && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-center text-sm text-destructive">
                        Access denied. You must be a member of the authorized GitHub organization.
                    </div>
                )}

                {error && error !== 'AccessDenied' && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-center text-sm text-destructive">
                        An error occurred during sign in. Please try again.
                    </div>
                )}

                <button
                    onClick={() => signIn('github', { callbackUrl: '/dashboard' })}
                    className="flex w-full items-center justify-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                    <Github className="h-5 w-5" />
                    Sign in with GitHub
                </button>

                <p className="text-center text-xs text-muted-foreground">
                    Team members only. Sign in with your GitHub account.
                </p>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginContent />
        </Suspense>
    );
}
