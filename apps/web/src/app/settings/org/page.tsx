'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Building2, Save } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api-fetch';

interface OrgData {
    id: string;
    name: string;
    email: string;
    logoUrl: string | null;
    tagline: string | null;
}

export default function OrgSettingsPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const [org, setOrg] = useState<OrgData | null>(null);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [logoUrl, setLogoUrl] = useState('');
    const [tagline, setTagline] = useState('');
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [success, setSuccess] = useState(false);

    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.role === 'ADMIN';

    const fetchOrg = useCallback(async () => {
        try {
            const res = await apiFetch('/api/org');
            if (!res.ok) return;
            const data = await res.json();
            setOrg(data);
            setName(data.name);
            setEmail(data.email);
            setLogoUrl(data.logoUrl || '');
            setTagline(data.tagline || '');
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        fetchOrg();
    }, [fetchOrg]);

    useEffect(() => {
        if (session && !isAdmin) {
            router.replace('/settings');
        }
    }, [session, isAdmin, router]);

    const handleSave = async () => {
        setSaving(true);
        setErrors([]);
        setSuccess(false);

        try {
            const res = await apiFetch('/api/org', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, logoUrl, tagline }),
            });

            const data = await res.json();

            if (!res.ok) {
                setErrors(data.errors || [data.error || 'Failed to save.']);
                return;
            }

            setOrg(data);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch {
            setErrors(['An unexpected error occurred.']);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) {
        return null;
    }

    return (
        <div>
            <PageHeader
                title="Organization"
                description="Manage your organization details."
                icon={Building2}
                breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Organization' }]}
            />

            <div className="max-w-lg space-y-6">
                {errors.length > 0 && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                        <ul className="list-disc pl-4 space-y-1">
                            {errors.map((err, i) => (
                                <li key={i}>{err}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {success && (
                    <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-500">
                        Organization updated successfully.
                    </div>
                )}

                {org && (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="orgName" className="block text-sm font-medium text-muted-foreground mb-1">
                                Name
                            </label>
                            <input
                                id="orgName"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label htmlFor="orgEmail" className="block text-sm font-medium text-muted-foreground mb-1">
                                Support Email
                            </label>
                            <input
                                id="orgEmail"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label htmlFor="orgLogoUrl" className="block text-sm font-medium text-muted-foreground mb-1">
                                Logo URL
                            </label>
                            <input
                                id="orgLogoUrl"
                                type="url"
                                value={logoUrl}
                                onChange={(e) => setLogoUrl(e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label htmlFor="orgTagline" className="block text-sm font-medium text-muted-foreground mb-1">
                                Tagline
                            </label>
                            <input
                                id="orgTagline"
                                type="text"
                                value={tagline}
                                onChange={(e) => setTagline(e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                            <Save className="h-4 w-4" />
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
