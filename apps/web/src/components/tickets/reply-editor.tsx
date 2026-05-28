'use client';

import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { cn } from '@/lib/utils';

interface ReplyEditorProps {
    suggestedResponse?: string | null;
    onSend: (content: string) => void;
    className?: string;
}

export interface ReplyEditorHandle {
    focus: () => void;
}

export const ReplyEditor = forwardRef<ReplyEditorHandle, ReplyEditorProps>(
    function ReplyEditor({ suggestedResponse, onSend, className }, ref) {
        const [content, setContent] = useState('');
        const [showSuggestion, setShowSuggestion] = useState(false);
        const textareaRef = useRef<HTMLTextAreaElement>(null);

        useImperativeHandle(ref, () => ({
            focus: () => {
                textareaRef.current?.focus();
            },
        }));

        const handleSend = () => {
            const text = content.trim();
            if (!text) return;
            onSend(text);
            setContent('');
        };

        const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
            }
        };

        const insertFormatting = (prefix: string, suffix: string) => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selected = content.slice(start, end);
            const newContent = content.slice(0, start) + prefix + selected + suffix + content.slice(end);
            setContent(newContent);
            // Restore cursor position after prefix
            requestAnimationFrame(() => {
                textarea.focus();
                textarea.setSelectionRange(start + prefix.length, end + prefix.length);
            });
        };

        const useSuggestion = () => {
            if (suggestedResponse) {
                setContent(suggestedResponse);
                setShowSuggestion(false);
                textareaRef.current?.focus();
            }
        };

        return (
            <div className={cn('border-t border-border', className)}>
                {suggestedResponse && (
                    <div className="px-4 pt-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                                Suggested response
                            </span>
                            <button
                                onClick={() => setShowSuggestion(!showSuggestion)}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {showSuggestion ? 'Hide' : 'Show suggestion'}
                            </button>
                        </div>
                        {showSuggestion && (
                            <div className="mt-1.5 p-2.5 rounded bg-violet-500/10 border border-violet-500/20">
                                <p className="text-xs text-violet-700 dark:text-violet-200 leading-relaxed whitespace-pre-wrap">
                                    {suggestedResponse}
                                </p>
                                <button
                                    onClick={useSuggestion}
                                    className="mt-2 text-[10px] font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 transition-colors"
                                >
                                    Use this response
                                </button>
                            </div>
                        )}
                    </div>
                )}
                <div className="p-4">
                    {/* Toolbar */}
                    <div className="flex items-center gap-1 mb-2">
                        <button
                            onClick={() => insertFormatting('**', '**')}
                            className="p-1 rounded text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Bold"
                        >
                            B
                        </button>
                        <button
                            onClick={() => insertFormatting('*', '*')}
                            className="p-1 rounded text-xs italic text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Italic"
                        >
                            I
                        </button>
                        <button
                            onClick={() => insertFormatting('`', '`')}
                            className="p-1 rounded text-xs font-mono text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Inline Code"
                        >
                            {'</>'}
                        </button>
                        <button
                            onClick={() => insertFormatting('\n```\n', '\n```\n')}
                            className="p-1 rounded text-[10px] font-mono text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Code Block"
                        >
                            {'{ }'}
                        </button>
                        <button
                            onClick={() => insertFormatting('[', '](url)')}
                            className="p-1 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Link"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                        </button>
                        <button
                            onClick={() => insertFormatting('- ', '')}
                            className="p-1 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="List"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                        <div className="flex-1" />
                        <button
                            className="p-1 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Attach file"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                        </button>
                    </div>
                    {/* Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Press R to reply..."
                        rows={3}
                        className="w-full text-sm bg-background border border-input rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring resize-none"
                        data-testid="reply-textarea"
                    />
                    {/* Send button */}
                    <div className="flex justify-end mt-2">
                        <button
                            onClick={handleSend}
                            disabled={!content.trim()}
                            className={cn(
                                'text-xs font-medium px-4 py-1.5 rounded transition-colors',
                                content.trim()
                                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                    : 'bg-muted text-muted-foreground cursor-not-allowed',
                            )}
                            data-testid="send-button"
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        );
    },
);
