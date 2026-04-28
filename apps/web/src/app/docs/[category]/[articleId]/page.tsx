'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ArticleEditor } from '@/components/docs/article-editor';

interface DocArticle {
    id: string;
    title: string;
    content: string;
    status: 'DRAFT' | 'PUBLISHED';
    sourceUrl?: string | null;
    categoryId: string;
    category?: { id: string; name: string };
    createdAt: string;
    updatedAt: string;
}

interface ArticlePageProps {
    params: Promise<{ category: string; articleId: string }>;
}

export default function ArticlePage({ params }: ArticlePageProps) {
    const { category: categoryId, articleId } = use(params);
    const [article, setArticle] = useState<DocArticle | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchArticle() {
            try {
                const res = await fetch(`/api/docs/articles/${articleId}`);
                if (!res.ok) {
                    setNotFound(true);
                    return;
                }
                const data = await res.json();
                setArticle(data);
            } finally {
                setLoading(false);
            }
        }
        fetchArticle();
    }, [articleId]);

    const handleSave = useCallback(async (content: string) => {
        setError(null);
        try {
            const res = await fetch(`/api/docs/articles/${articleId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            if (res.ok) {
                const updated = await res.json();
                setArticle(updated);
            } else {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `Failed to save article (${res.status})`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
            throw err;
        }
    }, [articleId]);

    const handleTogglePublish = useCallback(async () => {
        if (!article) return;
        setError(null);
        try {
            const newStatus = article.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
            const res = await fetch(`/api/docs/articles/${articleId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (res.ok) {
                const updated = await res.json();
                setArticle(updated);
            } else {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? `Failed to update publish status (${res.status})`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
        }
    }, [articleId, article]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <p className="text-muted-foreground">Loading...</p>
            </div>
        );
    }

    if (notFound || !article) {
        return (
            <div className="flex items-center justify-center py-20">
                <p className="text-muted-foreground">Article not found.</p>
            </div>
        );
    }

    const categoryName = article.category?.name || 'Category';

    return (
        <div>
            <PageHeader
                title={article.title}
                icon={FileText}
                breadcrumbs={[
                    { label: 'Docs', href: '/docs' },
                    { label: categoryName, href: `/docs/${categoryId}` },
                    { label: article.title },
                ]}
            />

            {error && (
                <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            <ArticleEditor
                article={article}
                onSave={handleSave}
                onTogglePublish={handleTogglePublish}
            />
        </div>
    );
}
