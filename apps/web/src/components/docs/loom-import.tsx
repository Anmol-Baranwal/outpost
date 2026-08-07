'use client';

import { useState } from 'react';
import { Video, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-fetch';

function isValidLoomUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'www.loom.com' || parsed.hostname === 'loom.com';
    } catch {
        return false;
    }
}

type ImportState = 'idle' | 'validating' | 'generating' | 'complete' | 'error';

interface LoomImportProps {
    categoryId?: string;
    onArticleGenerated?: (articleId: string) => void;
}

export function LoomImport({ categoryId, onArticleGenerated }: LoomImportProps) {
    const [url, setUrl] = useState('');
    const [state, setState] = useState<ImportState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    async function handleImport() {
        setError(null);

        if (!url.trim()) {
            setError('Please enter a Loom URL');
            return;
        }

        if (!isValidLoomUrl(url)) {
            setError('Please enter a valid Loom URL (e.g., https://www.loom.com/share/...)');
            setState('error');
            return;
        }

        setState('validating');
        setProgress(10);

        try {
            setState('generating');
            setProgress(30);

            const res = await apiFetch('/api/docs/import-loom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, categoryId }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to import Loom video');
            }

            setProgress(100);
            setState('complete');

            const article = await res.json();
            onArticleGenerated?.(article.id);
        } catch (err) {
            setState('error');
            setError(err instanceof Error ? err.message : 'Failed to import Loom video');
            setProgress(0);
        }
    }

    function handleReset() {
        setUrl('');
        setState('idle');
        setError(null);
        setProgress(0);
    }

    const isProcessing = state === 'validating' || state === 'generating';

    return (
        <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-center gap-3 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                    <Video className="h-4 w-4" />
                </div>
                <div>
                    <h3 className="font-semibold text-card-foreground">Import from Loom</h3>
                    <p className="text-xs text-muted-foreground">
                        Paste a Loom video URL to auto-generate a knowledge base article
                    </p>
                </div>
            </div>

            <div className="flex gap-2">
                <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.loom.com/share/..."
                    disabled={isProcessing || state === 'complete'}
                    className={cn(
                        'flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground',
                        'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                />
                {state === 'complete' ? (
                    <button
                        onClick={handleReset}
                        className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
                    >
                        Import Another
                    </button>
                ) : (
                    <button
                        onClick={handleImport}
                        disabled={isProcessing}
                        className={cn(
                            'inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white',
                            'hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                        )}
                    >
                        {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {isProcessing ? 'Generating...' : 'Generate Article'}
                    </button>
                )}
            </div>

            {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {error}
                </div>
            )}

            {isProcessing && (
                <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                        <span>
                            {state === 'validating' ? 'Validating Loom URL...' : 'Generating article from transcript...'}
                        </span>
                        <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                            className="h-full rounded-full bg-purple-500 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}

            {state === 'complete' && (
                <div className="mt-3 flex items-center gap-2 text-sm text-green-400">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                    Article generated successfully! It has been saved as a draft.
                </div>
            )}
        </div>
    );
}
