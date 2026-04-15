'use client';

import { use, useState, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ArticleEditor } from '@/components/docs/article-editor';
import { getArticleById, getCategoryBySlug } from '@/lib/mock-docs';
import type { DocArticle } from '@/lib/mock-docs';
import { notFound } from 'next/navigation';

interface ArticlePageProps {
    params: Promise<{ category: string; articleId: string }>;
}

export default function ArticlePage({ params }: ArticlePageProps) {
    const { category: categorySlug, articleId } = use(params);
    const category = getCategoryBySlug(categorySlug);
    const originalArticle = getArticleById(articleId);

    if (!category || !originalArticle) {
        notFound();
    }

    const [article, setArticle] = useState<DocArticle>(originalArticle);

    const handleSave = useCallback((content: string) => {
        setArticle(prev => ({
            ...prev,
            content,
            updatedAt: new Date().toISOString(),
        }));
    }, []);

    const handleTogglePublish = useCallback(() => {
        setArticle(prev => ({
            ...prev,
            status: prev.status === 'published' ? 'draft' : 'published',
            updatedAt: new Date().toISOString(),
        }));
    }, []);

    return (
        <div>
            <PageHeader
                title={article.title}
                icon={FileText}
                breadcrumbs={[
                    { label: 'Docs', href: '/docs' },
                    { label: category.name, href: `/docs/${categorySlug}` },
                    { label: article.title },
                ]}
            />

            <ArticleEditor
                article={article}
                onSave={handleSave}
                onTogglePublish={handleTogglePublish}
            />
        </div>
    );
}
