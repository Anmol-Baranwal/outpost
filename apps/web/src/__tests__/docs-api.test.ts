import { describe, it, expect } from 'vitest';
import {
    MOCK_CATEGORIES,
    MOCK_ARTICLES,
    getArticlesByCategory,
    getArticleById,
    getCategoryBySlug,
    isValidLoomUrl,
} from '@/lib/mock-docs';

describe('Docs mock data and utilities', () => {
    describe('MOCK_CATEGORIES', () => {
        it('has 3 categories', () => {
            expect(MOCK_CATEGORIES).toHaveLength(3);
        });

        it('each category has correct article count', () => {
            for (const category of MOCK_CATEGORIES) {
                const articles = MOCK_ARTICLES.filter(a => a.categorySlug === category.slug);
                expect(category.articleCount).toBe(articles.length);
            }
        });
    });

    describe('MOCK_ARTICLES', () => {
        it('has 15 articles total (5 per category)', () => {
            expect(MOCK_ARTICLES).toHaveLength(15);
        });

        it('each category has exactly 5 articles', () => {
            const gettingStarted = MOCK_ARTICLES.filter(a => a.categorySlug === 'getting-started');
            const apiRef = MOCK_ARTICLES.filter(a => a.categorySlug === 'api-reference');
            const guides = MOCK_ARTICLES.filter(a => a.categorySlug === 'guides');

            expect(gettingStarted).toHaveLength(5);
            expect(apiRef).toHaveLength(5);
            expect(guides).toHaveLength(5);
        });

        it('has a mix of draft and published articles', () => {
            const drafts = MOCK_ARTICLES.filter(a => a.status === 'draft');
            const published = MOCK_ARTICLES.filter(a => a.status === 'published');

            expect(drafts.length).toBeGreaterThan(0);
            expect(published.length).toBeGreaterThan(0);
        });
    });

    describe('getArticlesByCategory', () => {
        it('returns articles for a valid category', () => {
            const articles = getArticlesByCategory('getting-started');
            expect(articles).toHaveLength(5);
            expect(articles.every(a => a.categorySlug === 'getting-started')).toBe(true);
        });

        it('returns empty array for unknown category', () => {
            const articles = getArticlesByCategory('nonexistent');
            expect(articles).toHaveLength(0);
        });
    });

    describe('getArticleById', () => {
        it('returns an article for a valid ID', () => {
            const article = getArticleById('art-001');
            expect(article).toBeDefined();
            expect(article?.id).toBe('art-001');
            expect(article?.title).toBe('Quick Start Guide');
        });

        it('returns undefined for an invalid ID', () => {
            const article = getArticleById('nonexistent');
            expect(article).toBeUndefined();
        });
    });

    describe('getCategoryBySlug', () => {
        it('returns a category for a valid slug', () => {
            const category = getCategoryBySlug('api-reference');
            expect(category).toBeDefined();
            expect(category?.name).toBe('API Reference');
        });

        it('returns undefined for an invalid slug', () => {
            const category = getCategoryBySlug('nonexistent');
            expect(category).toBeUndefined();
        });
    });

    describe('isValidLoomUrl', () => {
        it('accepts valid www.loom.com URLs', () => {
            expect(isValidLoomUrl('https://www.loom.com/share/abc123')).toBe(true);
        });

        it('accepts valid loom.com URLs without www', () => {
            expect(isValidLoomUrl('https://loom.com/share/abc123')).toBe(true);
        });

        it('rejects non-loom URLs', () => {
            expect(isValidLoomUrl('https://youtube.com/watch?v=123')).toBe(false);
            expect(isValidLoomUrl('https://google.com')).toBe(false);
        });

        it('rejects malformed URLs', () => {
            expect(isValidLoomUrl('not-a-url')).toBe(false);
            expect(isValidLoomUrl('')).toBe(false);
        });

        it('rejects URLs with loom in subdomain of other hosts', () => {
            expect(isValidLoomUrl('https://loom.evil.com/share/abc')).toBe(false);
        });
    });
});
