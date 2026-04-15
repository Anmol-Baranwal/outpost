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
            <div className={cn('border-t border-slate-200', className)}>
                {suggestedResponse && (
                    <div className="px-4 pt-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-purple-600">
                                Suggested response
                            </span>
                            <button
                                onClick={() => setShowSuggestion(!showSuggestion)}
                                className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                {showSuggestion ? 'Hide' : 'Show suggestion'}
                            </button>
                        </div>
                        {showSuggestion && (
                            <div className="mt-1.5 p-2.5 rounded bg-purple-50 border border-purple-100">
                                <p className="text-xs text-purple-800 leading-relaxed whitespace-pre-wrap">
                                    {suggestedResponse}
                                </p>
                                <button
                                    onClick={useSuggestion}
                                    className="mt-2 text-[10px] font-medium text-purple-600 hover:text-purple-800 transition-colors"
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
                            className="p-1 rounded text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                            title="Bold"
                        >
                            B
                        </button>
                        <button
                            onClick={() => insertFormatting('*', '*')}
                            className="p-1 rounded text-xs italic text-slate-500 hover:bg-slate-100 transition-colors"
                            title="Italic"
                        >
                            I
                        </button>
                        <button
                            onClick={() => insertFormatting('`', '`')}
                            className="p-1 rounded text-xs font-mono text-slate-500 hover:bg-slate-100 transition-colors"
                            title="Inline Code"
                        >
                            {'</>'}
                        </button>
                        <button
                            onClick={() => insertFormatting('\n```\n', '\n```\n')}
                            className="p-1 rounded text-[10px] font-mono text-slate-500 hover:bg-slate-100 transition-colors"
                            title="Code Block"
                        >
                            {'{ }'}
                        </button>
                        <button
                            onClick={() => insertFormatting('[', '](url)')}
                            className="p-1 rounded text-xs text-slate-500 hover:bg-slate-100 transition-colors"
                            title="Link"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                        </button>
                        <button
                            onClick={() => insertFormatting('- ', '')}
                            className="p-1 rounded text-xs text-slate-500 hover:bg-slate-100 transition-colors"
                            title="List"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                        <div className="flex-1" />
                        <button
                            className="p-1 rounded text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
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
                        className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 resize-none"
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
                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed',
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
