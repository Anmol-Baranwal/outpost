import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { ArticleList } from '@/components/docs/article-list';

// Mock next/link
vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
        <a href={href} {...props}>{children}</a>
    ),
}));

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

const mockArticles: DocArticle[] = [
    {
        id: 'art-001',
        categoryId: 'getting-started',
        title: 'Quick Start Guide',
        status: 'PUBLISHED',
        content: '# Quick Start',
        updatedAt: '2024-12-01T00:00:00.000Z',
        createdAt: '2024-11-01T00:00:00.000Z',
        sourceUrl: null,
    },
    {
        id: 'art-002',
        categoryId: 'getting-started',
        title: 'AI Generated Draft',
        status: 'DRAFT',
        content: '# Draft',
        updatedAt: '2024-12-05T00:00:00.000Z',
        createdAt: '2024-11-15T00:00:00.000Z',
        sourceUrl: null,
    },
    {
        id: 'art-003',
        categoryId: 'getting-started',
        title: 'Another Published Article',
        status: 'PUBLISHED',
        content: '# Published',
        updatedAt: '2024-12-03T00:00:00.000Z',
        createdAt: '2024-11-10T00:00:00.000Z',
        sourceUrl: null,
    },
];

describe('ArticleList', () => {
    it('renders all articles', () => {
        render(<ArticleList articles={mockArticles} categoryId="getting-started" />);

        expect(screen.getByText('Quick Start Guide')).toBeInTheDocument();
        expect(screen.getByText('AI Generated Draft')).toBeInTheDocument();
        expect(screen.getByText('Another Published Article')).toBeInTheDocument();
    });

    it('displays status badges correctly', () => {
        render(<ArticleList articles={mockArticles} categoryId="getting-started" />);

        const publishedBadges = screen.getAllByText('Published');
        const draftBadges = screen.getAllByText('Draft');

        expect(publishedBadges).toHaveLength(2);
        expect(draftBadges).toHaveLength(1);
    });

    it('filters to only published articles when passed filtered list', () => {
        const published = mockArticles.filter(a => a.status === 'PUBLISHED');
        render(<ArticleList articles={published} categoryId="getting-started" />);

        expect(screen.getByText('Quick Start Guide')).toBeInTheDocument();
        expect(screen.getByText('Another Published Article')).toBeInTheDocument();
        expect(screen.queryByText('AI Generated Draft')).not.toBeInTheDocument();
    });

    it('filters to only draft articles when passed filtered list', () => {
        const drafts = mockArticles.filter(a => a.status === 'DRAFT');
        render(<ArticleList articles={drafts} categoryId="getting-started" />);

        expect(screen.getByText('AI Generated Draft')).toBeInTheDocument();
        expect(screen.queryByText('Quick Start Guide')).not.toBeInTheDocument();
    });

    it('shows empty state when no articles', () => {
        render(<ArticleList articles={[]} categoryId="getting-started" />);

        expect(screen.getByText(/No documentation articles yet/)).toBeInTheDocument();
    });

    it('links articles to their detail page', () => {
        render(<ArticleList articles={[mockArticles[0]]} categoryId="getting-started" />);

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/docs/getting-started/art-001');
    });
});
