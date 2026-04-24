'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { DocArticle } from '@/lib/mock-docs';

interface ArticleListProps {
    articles: DocArticle[];
    categorySlug: string;
}

function StatusBadge({ status }: { status: DocArticle['status'] }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                status === 'published'
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-yellow-500/10 text-yellow-400',
            )}
        >
            {status === 'published' ? 'Published' : 'Draft'}
        </span>
    );
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

export function ArticleList({ articles, categorySlug }: ArticleListProps) {
    if (articles.length === 0) {
        return (
            <div className="rounded-lg border border-border bg-card p-8 text-center" data-testid="articles-empty">
                <p className="text-muted-foreground">
                    No documentation articles yet. Create articles or import from Loom.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {articles.map((article) => (
                <Link
                    key={article.id}
                    href={`/docs/${categorySlug}/${article.id}`}
                    className={cn(
                        'flex items-center justify-between rounded-lg border border-border bg-card p-4',
                        'transition-colors hover:border-primary/50 hover:bg-card/80',
                    )}
                >
                    <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-card-foreground truncate">
                            {article.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Updated {formatDate(article.updatedAt)}
                        </p>
                    </div>
                    <StatusBadge status={article.status} />
                </Link>
            ))}
        </div>
    );
}
