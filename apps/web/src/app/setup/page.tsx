'use client';

import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Mountain } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function SetupPage() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [errors, setErrors] = useState<string[]>([]);

    // Check if setup is needed — redirect to login if members already exist
    useEffect(() => {
        fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
            .then((res) => {
                if (res.status === 403) {
                    router.replace('/login');
                } else {
                    // 400 = validation errors, meaning setup is still available
                    setChecking(false);
                }
            })
            .catch(() => {
                setChecking(false);
            });
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setErrors([]);

        try {
            const res = await fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, confirmPassword }),
            });

            if (res.status === 403) {
                router.replace('/login');
                return;
            }

            const data = await res.json();

            if (!res.ok) {
                setErrors(data.errors || ['An unexpected error occurred.']);
                setLoading(false);
                return;
            }

            // Auto sign-in after creation
            await signIn('credentials', {
                email,
                password,
                callbackUrl: '/dashboard',
            });
        } catch {
            setErrors(['An unexpected error occurred. Please try again.']);
            setLoading(false);
        }
    };

    if (checking) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-muted-foreground text-sm">Loading...</div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-sm space-y-8 px-4">
                <div className="text-center">
                    <div className="flex justify-center">
                        <Mountain className="h-12 w-12 text-primary" />
                    </div>
                    <h1 className="mt-4 text-2xl font-bold text-foreground">
                        Welcome to Outpost
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Create your admin account
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
                        <label htmlFor="name" className="block text-sm font-medium text-muted-foreground mb-1">
                            Name
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
                        <label htmlFor="email" className="block text-sm font-medium text-muted-foreground mb-1">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="admin@company.com"
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
                        disabled={loading}
                        className="flex w-full items-center justify-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {loading ? 'Creating account...' : 'Create Admin Account'}
                    </button>
                </form>
            </div>
        </div>
    );
}
