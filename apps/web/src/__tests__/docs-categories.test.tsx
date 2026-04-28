import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryCard } from '@/components/docs/category-card';

// Mock next/link
vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
        <a href={href} {...props}>{children}</a>
    ),
}));

interface DocCategory {
    id: string;
    name: string;
    description: string | null;
    articleCount: number;
    createdAt: string;
}

const mockCategory: DocCategory = {
    id: 'getting-started',
    name: 'Getting Started',
    description: 'Quick start guides and tutorials for new users',
    articleCount: 5,
    createdAt: '2024-11-01T00:00:00.000Z',
};

describe('CategoryCard', () => {
    it('renders category name and description', () => {
        render(<CategoryCard category={mockCategory} />);

        expect(screen.getByText('Getting Started')).toBeInTheDocument();
        expect(screen.getByText('Quick start guides and tutorials for new users')).toBeInTheDocument();
    });

    it('renders article count', () => {
        render(<CategoryCard category={mockCategory} />);

        expect(screen.getByText('5 articles')).toBeInTheDocument();
    });

    it('renders singular article text for count of 1', () => {
        const singleCategory = { ...mockCategory, articleCount: 1 };
        render(<CategoryCard category={singleCategory} />);

        expect(screen.getByText('1 article')).toBeInTheDocument();
    });

    it('links to the category page', () => {
        render(<CategoryCard category={mockCategory} />);

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/docs/getting-started');
    });
});
