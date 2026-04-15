import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArticleEditor } from '@/components/docs/article-editor';
import type { DocArticle } from '@/lib/mock-docs';

// Mock react-markdown since it's ESM and problematic in test
vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('remark-gfm', () => ({
    default: () => {},
}));

const draftArticle: DocArticle = {
    id: 'art-001',
    categorySlug: 'getting-started',
    title: 'Test Article',
    status: 'draft',
    content: '# Hello World',
    updatedAt: '2024-12-01T00:00:00.000Z',
    createdAt: '2024-11-01T00:00:00.000Z',
    source: 'manual',
};

const publishedArticle: DocArticle = {
    ...draftArticle,
    status: 'published',
};

describe('ArticleEditor - Publish Toggle', () => {
    it('shows Publish button for draft articles', () => {
        render(<ArticleEditor article={draftArticle} />);

        expect(screen.getByText('Publish')).toBeInTheDocument();
        expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    it('shows Unpublish button for published articles', () => {
        render(<ArticleEditor article={publishedArticle} />);

        expect(screen.getByText('Unpublish')).toBeInTheDocument();
        expect(screen.getByText('Published')).toBeInTheDocument();
    });

    it('calls onTogglePublish when publish button is clicked', () => {
        const onToggle = vi.fn();
        render(<ArticleEditor article={draftArticle} onTogglePublish={onToggle} />);

        fireEvent.click(screen.getByText('Publish'));
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('calls onTogglePublish when unpublish button is clicked', () => {
        const onToggle = vi.fn();
        render(<ArticleEditor article={publishedArticle} onTogglePublish={onToggle} />);

        fireEvent.click(screen.getByText('Unpublish'));
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('enters edit mode when Edit is clicked', () => {
        render(<ArticleEditor article={draftArticle} />);

        fireEvent.click(screen.getByText('Edit'));

        expect(screen.getByText('Save')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls onSave with new content', () => {
        const onSave = vi.fn();
        render(<ArticleEditor article={draftArticle} onSave={onSave} />);

        fireEvent.click(screen.getByText('Edit'));

        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: '# Updated Content' } });
        fireEvent.click(screen.getByText('Save'));

        expect(onSave).toHaveBeenCalledWith('# Updated Content');
    });

    it('reverts content on cancel', () => {
        render(<ArticleEditor article={draftArticle} />);

        fireEvent.click(screen.getByText('Edit'));

        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: '# Changed' } });
        fireEvent.click(screen.getByText('Cancel'));

        // Should be back in view mode showing original content
        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.queryByText('Save')).not.toBeInTheDocument();
    });

    it('renders article source when available', () => {
        render(<ArticleEditor article={draftArticle} />);

        expect(screen.getByText('Source: manual')).toBeInTheDocument();
    });
});
