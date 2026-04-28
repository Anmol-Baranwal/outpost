'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Eye, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface ArticleEditorProps {
    article: DocArticle;
    onSave?: (content: string) => void;
    onTogglePublish?: () => void;
}

export function ArticleEditor({ article, onSave, onTogglePublish }: ArticleEditorProps) {
    const [editing, setEditing] = useState(false);
    const [content, setContent] = useState(article.content);

    useEffect(() => {
        setContent(article.content);
    }, [article.content]);

    function handleSave() {
        onSave?.(content);
        setEditing(false);
    }

    function handleCancel() {
        setContent(article.content);
        setEditing(false);
    }

    return (
        <div>
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span
                        className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            article.status === 'PUBLISHED'
                                ? 'bg-green-500/10 text-green-400'
                                : 'bg-yellow-500/10 text-yellow-400',
                        )}
                    >
                        {article.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                    </span>
                    {article.sourceUrl && (
                        <span className="text-xs text-muted-foreground">
                            Source: Imported
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onTogglePublish}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                            article.status === 'PUBLISHED'
                                ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                                : 'bg-green-500/10 text-green-400 hover:bg-green-500/20',
                        )}
                    >
                        {article.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                    </button>
                    {editing ? (
                        <>
                            <button
                                onClick={handleSave}
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                                <Check className="h-3.5 w-3.5" />
                                Save
                            </button>
                            <button
                                onClick={handleCancel}
                                className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
                            >
                                <X className="h-3.5 w-3.5" />
                                Cancel
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={() => setEditing(true)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                        </button>
                    )}
                </div>
            </div>

            {editing ? (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full min-h-[500px] rounded-lg border border-border bg-background p-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
            ) : (
                <div className="prose prose-invert max-w-none rounded-lg border border-border bg-card p-6">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {article.content}
                    </ReactMarkdown>
                </div>
            )}
        </div>
    );
}
