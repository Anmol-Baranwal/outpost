'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Mountain } from 'lucide-react';

function AcceptInviteContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [orgName, setOrgName] = useState('Outpost');
    const [orgLogo, setOrgLogo] = useState<string | null>(null);
    const [tokenError, setTokenError] = useState<string | null>(null);

    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    useEffect(() => {
        if (!token) {
            setTokenError('No invitation token provided.');
            setLoading(false);
            return;
        }

        fetch(`/api/team/invite/accept?token=${encodeURIComponent(token)}`)
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) {
                    setTokenError(data.error || 'Invalid invitation.');
                } else {
                    setEmail(data.email);
                    setOrgName(data.orgName);
                    setOrgLogo(data.orgLogo);
                }
                setLoading(false);
            })
            .catch(() => {
                setTokenError('Failed to validate invitation.');
                setLoading(false);
            });
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setErrors([]);

        try {
            const res = await fetch('/api/team/invite/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, name, password, confirmPassword }),
            });

            const data = await res.json();

            if (!res.ok) {
                if (data.errors) {
                    setErrors(data.errors);
                } else {
                    setErrors([data.error || 'Failed to accept invitation.']);
                }
                setSubmitting(false);
                return;
            }

            // Auto sign-in and redirect
            await signIn('credentials', {
                email,
                password,
                callbackUrl: '/dashboard',
            });
        } catch {
            setErrors(['An unexpected error occurred.']);
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-muted-foreground text-sm">Validating invitation...</div>
            </div>
        );
    }

    if (tokenError) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="w-full max-w-sm space-y-6 px-4 text-center">
                    <Mountain className="mx-auto h-12 w-12 text-primary" />
                    <h1 className="text-2xl font-bold text-foreground">Invalid Invitation</h1>
                    <p className="text-sm text-muted-foreground">{tokenError}</p>
                    <a
                        href="/login"
                        className="inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity"
                    >
                        Go to Login
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-sm space-y-8 px-4">
                <div className="text-center">
                    {orgLogo ? (
                        <img src={orgLogo} alt={orgName} className="mx-auto h-12 w-12 rounded-lg" />
                    ) : (
                        <Mountain className="mx-auto h-12 w-12 text-primary" />
                    )}
                    <h1 className="mt-4 text-2xl font-bold text-foreground">
                        Join {orgName}
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        You&apos;ve been invited to join {orgName} on Outpost
                    </p>
                </div>

                {errors.length > 0 && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                        <ul className="list-disc pl-4 space-y-1">
                            {errors.map((err, i) => (
                                <li key={i}>{err}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-muted-foreground mb-1">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            readOnly
                            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                        />
                    </div>
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-muted-foreground mb-1">
                            Full Name
                        </label>
                        <input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Your name"
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-muted-foreground mb-1">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Min 8 characters"
                        />
                    </div>
                    <div>
                        <label htmlFor="confirmPassword" className="block text-sm font-medium text-muted-foreground mb-1">
                            Confirm Password
                        </label>
                        <input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Repeat your password"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex w-full items-center justify-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {submitting ? 'Setting up your account...' : 'Accept Invitation'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function AcceptInvitePage() {
    return (
        <Suspense>
            <AcceptInviteContent />
        </Suspense>
    );
}
