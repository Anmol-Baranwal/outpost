'use client';

import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { CategoryCard } from '@/components/docs/category-card';
import { ArticleList } from '@/components/docs/article-list';
import { LoomImport } from '@/components/docs/loom-import';
import { MOCK_CATEGORIES, MOCK_ARTICLES } from '@/lib/mock-docs';
import { cn } from '@/lib/utils';

type Tab = 'ai-drafts' | 'published';

export default function DocsPage() {
    const [activeTab, setActiveTab] = useState<Tab>('published');

    const aiDrafts = MOCK_ARTICLES.filter(a => a.status === 'draft' && (a.source === 'ai' || a.source === 'loom'));
    const published = MOCK_ARTICLES.filter(a => a.status === 'published');

    return (
        <div>
            <PageHeader
                title="Documentation"
                description="Knowledge base articles and documentation management."
                icon={FileText}
                breadcrumbs={[{ label: 'Docs' }]}
            />

            {/* Loom Import */}
            <div className="mb-8">
                <LoomImport />
            </div>

            {/* Categories Grid */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-foreground">Categories</h2>
                    <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                        <Plus className="h-3.5 w-3.5" />
                        Create New
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {MOCK_CATEGORIES.map((category) => (
                        <CategoryCard key={category.slug} category={category} />
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-6">
                <div className="flex items-center gap-1 border-b border-border">
                    <button
                        onClick={() => setActiveTab('ai-drafts')}
                        className={cn(
                            'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                            activeTab === 'ai-drafts'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                    >
                        AI Drafts
                        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs">
                            {aiDrafts.length}
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab('published')}
                        className={cn(
                            'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                            activeTab === 'published'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                    >
                        Published
                        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs">
                            {published.length}
                        </span>
                    </button>
                </div>
            </div>

            {/* Tab Content */}
            <ArticleList
                articles={activeTab === 'ai-drafts' ? aiDrafts : published}
                categorySlug=""
            />
        </div>
    );
}
