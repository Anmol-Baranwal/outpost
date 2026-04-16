'use client';

import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Mountain, ArrowLeft, ArrowRight, Rocket } from 'lucide-react';
import { useState, useEffect } from 'react';

type Step = 1 | 2 | 3;

export default function SetupPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>(1);
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [errors, setErrors] = useState<string[]>([]);

    // Step 1: Organization
    const [orgName, setOrgName] = useState('');
    const [orgEmail, setOrgEmail] = useState('');
    const [orgLogoUrl, setOrgLogoUrl] = useState('');
    const [orgTagline, setOrgTagline] = useState('');

    // Step 2: Admin account
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Check if setup is needed
    useEffect(() => {
        fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
            .then((res) => {
                if (res.status === 403) {
                    router.replace('/login');
                } else {
                    setChecking(false);
                }
            })
            .catch(() => {
                setChecking(false);
            });
    }, [router]);

    const validateStep1 = (): string[] => {
        const errs: string[] = [];
        if (!orgName.trim()) errs.push('Organization name is required.');
        if (!orgEmail.trim()) {
            errs.push('Organization email is required.');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgEmail)) {
            errs.push('Organization email must be a valid email address.');
        }
        return errs;
    };

    const validateStep2 = (): string[] => {
        const errs: string[] = [];
        if (!name.trim()) errs.push('Name is required.');
        if (!email.trim()) {
            errs.push('Email is required.');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errs.push('Email must be a valid email address.');
        }
        if (!password) {
            errs.push('Password is required.');
        } else if (password.length < 8) {
            errs.push('Password must be at least 8 characters.');
        }
        if (password !== confirmPassword) {
            errs.push('Passwords do not match.');
        }
        return errs;
    };

    const handleNext = () => {
        setErrors([]);
        if (step === 1) {
            const errs = validateStep1();
            if (errs.length > 0) { setErrors(errs); return; }
            setStep(2);
        } else if (step === 2) {
            const errs = validateStep2();
            if (errs.length > 0) { setErrors(errs); return; }
            setStep(3);
        }
    };

    const handleBack = () => {
        setErrors([]);
        if (step === 2) setStep(1);
        else if (step === 3) setStep(2);
    };

    const handleLaunch = async () => {
        setLoading(true);
        setErrors([]);

        try {
            const res = await fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orgName, orgEmail, orgLogoUrl, orgTagline,
                    name, email, password, confirmPassword,
                }),
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

    const stepLabels = ['Organization', 'Admin Account', 'Review'];

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-md space-y-8 px-4">
                {/* Header */}
                <div className="text-center">
                    <div className="flex justify-center">
                        <Mountain className="h-12 w-12 text-primary" />
                    </div>
                    <h1 className="mt-4 text-2xl font-bold text-foreground">
                        Welcome to Outpost
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Set up your workspace in a few steps
                    </p>
                </div>

                {/* Step indicator */}
                <div className="flex items-center justify-center gap-2">
                    {stepLabels.map((label, i) => {
                        const stepNum = (i + 1) as Step;
                        const isActive = step === stepNum;
                        const isComplete = step > stepNum;
                        return (
                            <div key={label} className="flex items-center gap-2">
                                {i > 0 && (
                                    <div className={`h-px w-8 ${isComplete || isActive ? 'bg-primary' : 'bg-border'}`} />
                                )}
                                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                                    isActive ? 'bg-primary text-primary-foreground' :
                                    isComplete ? 'bg-primary/20 text-primary' :
                                    'bg-muted text-muted-foreground'
                                }`}>
                                    {stepNum}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Errors */}
                {errors.length > 0 && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                        <ul className="list-disc pl-4 space-y-1">
                            {errors.map((err, i) => (
                                <li key={i}>{err}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Step 1: Organization */}
                {step === 1 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-foreground">Organization Details</h2>
                        <div>
                            <label htmlFor="orgName" className="block text-sm font-medium text-muted-foreground mb-1">
                                Organization Name
                            </label>
                            <input
                                id="orgName"
                                type="text"
                                value={orgName}
                                onChange={(e) => setOrgName(e.target.value)}
                                required
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Acme Corp"
                            />
                        </div>
                        <div>
                            <label htmlFor="orgEmail" className="block text-sm font-medium text-muted-foreground mb-1">
                                Support Email
                            </label>
                            <input
                                id="orgEmail"
                                type="email"
                                value={orgEmail}
                                onChange={(e) => setOrgEmail(e.target.value)}
                                required
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="support@acme.com"
                            />
                        </div>
                        <div>
                            <label htmlFor="orgLogoUrl" className="block text-sm font-medium text-muted-foreground mb-1">
                                Logo URL <span className="text-muted-foreground/60">(optional)</span>
                            </label>
                            <input
                                id="orgLogoUrl"
                                type="url"
                                value={orgLogoUrl}
                                onChange={(e) => setOrgLogoUrl(e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="https://acme.com/logo.png"
                            />
                        </div>
                        <div>
                            <label htmlFor="orgTagline" className="block text-sm font-medium text-muted-foreground mb-1">
                                Tagline <span className="text-muted-foreground/60">(optional)</span>
                            </label>
                            <input
                                id="orgTagline"
                                type="text"
                                value={orgTagline}
                                onChange={(e) => setOrgTagline(e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Building the future of support"
                            />
                        </div>
                    </div>
                )}

                {/* Step 2: Admin Account */}
                {step === 2 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-foreground">Admin Account</h2>
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
                    </div>
                )}

                {/* Step 3: Review */}
                {step === 3 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-foreground">Review</h2>
                        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Organization</h3>
                            <div className="space-y-1 text-sm">
                                <p><span className="text-muted-foreground">Name:</span> <span className="text-foreground">{orgName}</span></p>
                                <p><span className="text-muted-foreground">Email:</span> <span className="text-foreground">{orgEmail}</span></p>
                                {orgLogoUrl && <p><span className="text-muted-foreground">Logo:</span> <span className="text-foreground truncate">{orgLogoUrl}</span></p>}
                                {orgTagline && <p><span className="text-muted-foreground">Tagline:</span> <span className="text-foreground">{orgTagline}</span></p>}
                            </div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Admin Account</h3>
                            <div className="space-y-1 text-sm">
                                <p><span className="text-muted-foreground">Name:</span> <span className="text-foreground">{name}</span></p>
                                <p><span className="text-muted-foreground">Email:</span> <span className="text-foreground">{email}</span></p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Navigation buttons */}
                <div className="flex items-center justify-between">
                    {step > 1 ? (
                        <button
                            type="button"
                            onClick={handleBack}
                            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back
                        </button>
                    ) : (
                        <div />
                    )}

                    {step < 3 ? (
                        <button
                            type="button"
                            onClick={handleNext}
                            className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
                        >
                            Next
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleLaunch}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                            <Rocket className="h-4 w-4" />
                            {loading ? 'Launching...' : 'Launch Outpost'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
