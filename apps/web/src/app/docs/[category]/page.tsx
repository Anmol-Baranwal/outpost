'use client';

import { use } from 'react';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ArticleList } from '@/components/docs/article-list';
import { getCategoryBySlug, getArticlesByCategory } from '@/lib/mock-docs';
import { notFound } from 'next/navigation';

interface CategoryPageProps {
    params: Promise<{ category: string }>;
}

export default function CategoryPage({ params }: CategoryPageProps) {
    const { category: categorySlug } = use(params);
    const category = getCategoryBySlug(categorySlug);

    if (!category) {
        notFound();
    }

    const articles = getArticlesByCategory(categorySlug);

    return (
        <div>
            <PageHeader
                title={category.name}
                description={category.description}
                icon={FileText}
                breadcrumbs={[
                    { label: 'Docs', href: '/docs' },
                    { label: category.name },
                ]}
            />

            <ArticleList articles={articles} categorySlug={categorySlug} />
        </div>
    );
}
