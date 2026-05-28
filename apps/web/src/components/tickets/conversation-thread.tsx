'use client';

import { useEffect, useRef } from 'react';
import { MessageType } from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import type { TicketMessage } from './types';

interface ConversationThreadProps {
    messages: TicketMessage[];
    className?: string;
}

function formatTimestamp(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });
}

function DateSeparator({ date }: { date: string }) {
    return (
        <div className="flex items-center gap-3 py-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {formatDate(date)}
            </span>
            <div className="flex-1 border-t border-border" />
        </div>
    );
}

function SystemMessage({ message }: { message: TicketMessage }) {
    return (
        <div className="flex justify-center py-1.5">
            <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                {message.content}
            </span>
        </div>
    );
}

function AttachmentCard({ attachment }: { attachment: { name: string; url: string; size: string } }) {
    return (
        <a
            href={attachment.url}
            className="inline-flex items-center gap-2 mt-1.5 px-3 py-2 rounded border border-border bg-muted/50 hover:bg-muted transition-colors"
            target="_blank"
            rel="noopener noreferrer"
        >
            <svg
                className="h-4 w-4 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
            </svg>
            <div>
                <p className="text-xs font-medium text-foreground">{attachment.name}</p>
                <p className="text-[10px] text-muted-foreground">{attachment.size}</p>
            </div>
        </a>
    );
}

/**
 * Simple markdown-like rendering for message content.
 * Handles code blocks, inline code, bold, and italic.
 */
function MessageContent({ content }: { content: string }) {
    // Split content by code blocks first
    const parts = content.split(/(```[\s\S]*?```)/g);

    return (
        <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {parts.map((part, i) => {
                // Code block
                if (part.startsWith('```') && part.endsWith('```')) {
                    const inner = part.slice(3, -3);
                    const firstNewline = inner.indexOf('\n');
                    const lang = firstNewline > 0 ? inner.slice(0, firstNewline).trim() : '';
                    const code = firstNewline > 0 ? inner.slice(firstNewline + 1) : inner;
                    return (
                        <pre
                            key={i}
                            className="mt-2 mb-2 p-3 bg-slate-950 text-slate-100 rounded text-xs overflow-x-auto font-mono"
                        >
                            {lang && (
                                <span className="block text-[10px] text-slate-400 mb-1 uppercase">{lang}</span>
                            )}
                            <code>{code}</code>
                        </pre>
                    );
                }

                // Inline formatting
                return (
                    <span key={i}>
                        {part.split(/(`[^`]+`)/g).map((segment, j) => {
                            if (segment.startsWith('`') && segment.endsWith('`')) {
                                return (
                                    <code
                                        key={j}
                                        className="px-1 py-0.5 bg-muted text-foreground rounded text-xs font-mono"
                                    >
                                        {segment.slice(1, -1)}
                                    </code>
                                );
                            }
                            // Bold
                            return segment.split(/(\*\*[^*]+\*\*)/g).map((boldPart, k) => {
                                if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
                                    return (
                                        <strong key={`${j}-${k}`} className="font-semibold">
                                            {boldPart.slice(2, -2)}
                                        </strong>
                                    );
                                }
                                return <span key={`${j}-${k}`}>{boldPart}</span>;
                            });
                        })}
                    </span>
                );
            })}
        </div>
    );
}

function UserMessage({ message }: { message: TicketMessage }) {
    const isBot = message.type === MessageType.BOT;

    return (
        <div className="px-4 py-3 hover:bg-accent/40 transition-colors" data-testid="message">
            <div className="flex items-start gap-3">
                <div
                    className={cn(
                        'flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium',
                        isBot
                            ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                            : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                    )}
                >
                    {isBot ? 'AI' : (message.author ?? 'U').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-foreground">
                            {message.author ?? 'Unknown'}
                        </span>
                        {isBot && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium">
                                AI generated
                            </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                            {formatTimestamp(message.createdAt)}
                        </span>
                    </div>
                    <MessageContent content={message.content} />
                    {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {message.attachments.map((att, idx) => (
                                <AttachmentCard key={idx} attachment={att} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function ConversationThread({ messages, className }: ConversationThreadProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Scroll only the conversation panel itself, not any ancestor (which
        // would yank the whole page when scrollIntoView walks up the tree).
        const el = bottomRef.current;
        const container = el?.parentElement;
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
    }, [messages.length]);

    // Group messages by date for separators
    let lastDate = '';
    const elements: React.ReactNode[] = [];

    messages.forEach((message) => {
        const messageDate = new Date(message.createdAt).toDateString();
        if (messageDate !== lastDate) {
            lastDate = messageDate;
            elements.push(
                <DateSeparator key={`date-${messageDate}`} date={message.createdAt} />,
            );
        }

        if (message.type === MessageType.SYSTEM) {
            elements.push(<SystemMessage key={message.id} message={message} />);
        } else {
            elements.push(<UserMessage key={message.id} message={message} />);
        }
    });

    return (
        <div className={cn('flex-1 min-h-0 overflow-y-auto', className)} data-testid="conversation-thread">
            {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    No messages yet. Start the conversation below.
                </div>
            ) : (
                <>
                    {elements}
                    <div ref={bottomRef} />
                </>
            )}
        </div>
    );
}
