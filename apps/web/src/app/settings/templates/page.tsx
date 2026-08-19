'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, FileText, RotateCcw, Save, Eye, ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api-fetch';

interface TemplateEntry {
    slug: string;
    name: string;
    subject: string;
    isOverride: boolean;
    updatedAt: string | null;
    editedBy: string | null;
}

interface TemplateDetail {
    slug: string;
    name: string;
    subject: string;
    from: string;
    body: string;
    isOverride: boolean;
}

interface PreviewResult {
    subject: string;
    html: string;
    text: string;
    markdown: string;
}

export default function TemplatesPage() {
    const [templates, setTemplates] = useState<TemplateEntry[]>([]);
    const [selected, setSelected] = useState<TemplateDetail | null>(null);
    const [editSubject, setEditSubject] = useState('');
    const [editBody, setEditBody] = useState('');
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const fetchTemplates = useCallback(async () => {
        try {
            const res = await apiFetch('/api/templates');
            if (!res.ok) throw new Error('Failed to load templates');
            const data = await res.json();
            setTemplates(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load templates');
        }
    }, []);

    useEffect(() => {
        fetchTemplates();
    }, [fetchTemplates]);

    const selectTemplate = async (slug: string) => {
        setError(null);
        setSuccess(null);
        setShowPreview(false);
        setPreview(null);

        try {
            const res = await apiFetch(`/api/templates/${slug}`);
            if (!res.ok) throw new Error('Failed to load template');
            const data: TemplateDetail = await res.json();
            setSelected(data);
            setEditSubject(data.subject);
            setEditBody(data.body);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load template');
        }
    };

    const handlePreview = async () => {
        if (!selected) return;

        try {
            const res = await apiFetch(`/api/templates/${selected.slug}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error('Preview failed');
            const data: PreviewResult = await res.json();
            setPreview(data);
            setShowPreview(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Preview failed');
        }
    };

    const handleSave = async () => {
        if (!selected) return;
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const res = await apiFetch(`/api/templates/${selected.slug}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: editSubject, body: editBody }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSuccess('Template saved successfully');
            await fetchTemplates();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!selected) return;
        setError(null);
        setSuccess(null);

        try {
            const res = await apiFetch(`/api/templates/${selected.slug}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Reset failed');
            setSuccess('Template reset to default');
            await selectTemplate(selected.slug);
            await fetchTemplates();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Reset failed');
        }
    };

    return (
        <div>
            <PageHeader
                title="Email Templates"
                description="Manage outbound email templates. Customize content and preview before saving."
                icon={Mail}
                breadcrumbs={[
                    { label: 'Settings', href: '/settings' },
                    { label: 'Templates' },
                ]}
            />

            {error && (
                <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                    {error}
                </div>
            )}
            {success && (
                <div className="mb-4 rounded-md bg-green-500/10 p-3 text-sm text-green-400">
                    {success}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Template list */}
                <div className="lg:col-span-1">
                    <div className="rounded-lg border border-border bg-card">
                        <div className="border-b border-border p-4">
                            <h3 className="text-sm font-semibold text-foreground">Templates</h3>
                        </div>
                        <div className="divide-y divide-border">
                            {templates.map((t) => (
                                <button
                                    key={t.slug}
                                    onClick={() => selectTemplate(t.slug)}
                                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                                        selected?.slug === t.slug ? 'bg-muted/50' : ''
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-sm font-medium">{t.name}</span>
                                        </div>
                                        <span
                                            className={`text-xs px-2 py-0.5 rounded-full ${
                                                t.isOverride
                                                    ? 'bg-blue-500/10 text-blue-400'
                                                    : 'bg-muted text-muted-foreground'
                                            }`}
                                        >
                                            {t.isOverride ? 'Custom' : 'Default'}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground truncate">
                                        {t.subject}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Editor / Preview */}
                <div className="lg:col-span-2">
                    {selected ? (
                        <div className="rounded-lg border border-border bg-card">
                            <div className="border-b border-border p-4 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">
                                    {showPreview ? 'Preview' : 'Edit'}: {selected.name}
                                </h3>
                                <div className="flex items-center gap-2">
                                    {showPreview ? (
                                        <button
                                            onClick={() => setShowPreview(false)}
                                            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                            Back to Editor
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={handlePreview}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                                            >
                                                <Eye className="h-4 w-4" />
                                                Preview
                                            </button>
                                            <button
                                                onClick={handleReset}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                <RotateCcw className="h-4 w-4" />
                                                Reset
                                            </button>
                                            <button
                                                onClick={handleSave}
                                                disabled={saving}
                                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                            >
                                                <Save className="h-4 w-4" />
                                                {saving ? 'Saving...' : 'Save'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {showPreview && preview ? (
                                <div className="p-4">
                                    <div className="mb-4 rounded-md bg-muted/50 p-3">
                                        <p className="text-sm text-muted-foreground">
                                            <strong>Subject:</strong> {preview.subject}
                                        </p>
                                    </div>
                                    <div
                                        className="rounded-md border border-border bg-white p-4"
                                        dangerouslySetInnerHTML={{ __html: preview.html }}
                                    />
                                </div>
                            ) : (
                                <div className="p-4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1">
                                            Subject Line
                                        </label>
                                        <input
                                            type="text"
                                            value={editSubject}
                                            onChange={(e) => setEditSubject(e.target.value)}
                                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            placeholder="Email subject with {{variables}}"
                                        />
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Use {'{{variable}}'} syntax for dynamic values
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1">
                                            Body (Markdown)
                                        </label>
                                        <textarea
                                            value={editBody}
                                            onChange={(e) => setEditBody(e.target.value)}
                                            rows={16}
                                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            placeholder="Markdown content with {{variable}} interpolation..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-border bg-card p-12 text-center">
                            <FileText className="mx-auto h-12 w-12 text-muted-foreground/30" />
                            <p className="mt-4 text-sm text-muted-foreground">
                                Select a template from the list to edit it
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
