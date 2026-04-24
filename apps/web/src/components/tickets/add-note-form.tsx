'use client';

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { cn } from '@/lib/utils';

interface AddNoteFormProps {
    ticketId: string;
    onNoteAdded?: (note: { id: string; content: string; author: string; createdAt: string }) => void;
    className?: string;
}

export interface AddNoteFormHandle {
    focus: () => void;
    open: () => void;
}

export const AddNoteForm = forwardRef<AddNoteFormHandle, AddNoteFormProps>(
    function AddNoteForm({ ticketId, onNoteAdded, className }, ref) {
        const [isOpen, setIsOpen] = useState(false);
        const [content, setContent] = useState('');
        const [submitting, setSubmitting] = useState(false);
        const textareaRef = useRef<HTMLTextAreaElement>(null);

        useImperativeHandle(ref, () => ({
            focus: () => {
                setIsOpen(true);
                requestAnimationFrame(() => {
                    textareaRef.current?.focus();
                });
            },
            open: () => {
                setIsOpen(true);
                requestAnimationFrame(() => {
                    textareaRef.current?.focus();
                });
            },
        }));

        useEffect(() => {
            if (isOpen) {
                requestAnimationFrame(() => {
                    textareaRef.current?.focus();
                });
            }
        }, [isOpen]);

        const handleSubmit = async () => {
            const text = content.trim();
            if (!text) return;

            setSubmitting(true);
            try {
                const res = await fetch(`/api/tickets/${ticketId}/notes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: text }),
                });

                if (res.ok) {
                    const note = await res.json();
                    onNoteAdded?.(note);
                    setContent('');
                    setIsOpen(false);
                }
            } catch {
                // Silently fail in mock mode
            } finally {
                setSubmitting(false);
            }
        };

        const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
                setContent('');
            }
        };

        if (!isOpen) {
            return (
                <button
                    onClick={() => setIsOpen(true)}
                    className={cn(
                        'w-full rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors',
                        className,
                    )}
                    data-testid="add-note-button"
                >
                    + Add a note
                </button>
            );
        }

        return (
            <div className={cn('space-y-2', className)} data-testid="add-note-form">
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Write a note..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    data-testid="add-note-textarea"
                />
                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={() => {
                            setIsOpen(false);
                            setContent('');
                        }}
                        className="rounded-md px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                        data-testid="add-note-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!content.trim() || submitting}
                        className={cn(
                            'rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors',
                            content.trim() && !submitting
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'bg-muted text-muted-foreground cursor-not-allowed',
                        )}
                        data-testid="add-note-submit"
                    >
                        {submitting ? 'Saving...' : 'Add Note'}
                    </button>
                </div>
            </div>
        );
    },
);
