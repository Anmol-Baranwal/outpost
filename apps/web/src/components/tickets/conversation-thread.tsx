'use client';

import { useEffect, useRef } from 'react';
import { MessageType } from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import type { MockMessage } from '@/lib/mock-tickets';

interface ConversationThreadProps {
    messages: MockMessage[];
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
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                {formatDate(date)}
            </span>
            <div className="flex-1 border-t border-slate-200" />
        </div>
    );
}

function SystemMessage({ message }: { message: MockMessage }) {
    return (
        <div className="flex justify-center py-1.5">
            <span className="text-xs text-slate-400 bg-slate-50 px-3 py-1 rounded-full">
                {message.content}
            </span>
        </div>
    );
}

function AttachmentCard({ attachment }: { attachment: { name: string; url: string; size: string } }) {
    return (
        <a
            href={attachment.url}
            className="inline-flex items-center gap-2 mt-1.5 px-3 py-2 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
        >
            <svg
                className="h-4 w-4 text-slate-400"
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
                <p className="text-xs font-medium text-slate-700">{attachment.name}</p>
                <p className="text-[10px] text-slate-400">{attachment.size}</p>
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
        <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
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
                            className="mt-2 mb-2 p-3 bg-slate-900 text-slate-100 rounded text-xs overflow-x-auto font-mono"
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
                                        className="px-1 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-mono"
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

function UserMessage({ message }: { message: MockMessage }) {
    const isBot = message.type === MessageType.BOT;

    return (
        <div className="px-4 py-3 hover:bg-slate-50 transition-colors" data-testid="message">
            <div className="flex items-start gap-3">
                <div
                    className={cn(
                        'flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium',
                        isBot
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700',
                    )}
                >
                    {isBot ? 'AI' : message.author.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-slate-800">
                            {message.author}
                        </span>
                        {isBot && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">
                                AI generated
                            </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                            {formatTimestamp(message.createdAt)}
                        </span>
                    </div>
                    <MessageContent content={message.content} />
                    {message.attachments && message.attachments.length > 0 && (
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
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    // Group messages by date for separators
    let lastDate = '';
    const elements: React.ReactNode[] = [];

    messages.forEach((message, idx) => {
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
        <div className={cn('flex-1 overflow-y-auto', className)} data-testid="conversation-thread">
            {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-slate-400">
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
