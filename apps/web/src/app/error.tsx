'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Unhandled error:', error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-foreground">Something went wrong</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                An unexpected error occurred. Our team has been notified.
            </p>
            {error.digest && (
                <p className="mt-1 text-xs text-muted-foreground">
                    Error ID: {error.digest}
                </p>
            )}
            <button
                onClick={reset}
                className="mt-6 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
                <RotateCcw className="h-4 w-4" />
                Try again
            </button>
        </div>
    );
}
