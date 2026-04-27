'use client';

import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocCategory {
    id: string;
    name: string;
    description: string | null;
    articleCount: number;
    createdAt: string;
}

interface CategoryCardProps {
    category: DocCategory;
}

export function CategoryCard({ category }: CategoryCardProps) {
    return (
        <Link
            href={`/docs/${category.id}`}
            className={cn(
                'group block rounded-lg border border-border bg-card p-6',
                'transition-colors hover:border-primary/50 hover:bg-card/80',
            )}
        >
            <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FolderOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                    <h3 className="font-semibold text-card-foreground group-hover:text-primary transition-colors">
                        {category.name}
                    </h3>
                    {category.description && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                            {category.description}
                        </p>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                        {category.articleCount} {category.articleCount === 1 ? 'article' : 'articles'}
                    </p>
                </div>
            </div>
        </Link>
    );
}
