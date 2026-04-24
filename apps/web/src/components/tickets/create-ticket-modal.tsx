'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import {
    TicketPriority,
    TicketType,
    TicketSource,
} from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';

interface CreateTicketModalProps {
    open: boolean;
    onClose: () => void;
    onCreated?: (ticket: Record<string, unknown>) => void;
}

const priorityOptions: Record<string, string> = {
    [TicketPriority.LOW]: 'Low',
    [TicketPriority.MEDIUM]: 'Medium',
    [TicketPriority.HIGH]: 'High',
    [TicketPriority.CRITICAL]: 'Critical',
};

const typeOptions: Record<string, string> = {
    [TicketType.BUG]: 'Bug',
    [TicketType.FEATURE_REQUEST]: 'Feature Request',
    [TicketType.QUESTION]: 'Question',
    [TicketType.INTEGRATION_HELP]: 'Integration Help',
    [TicketType.ACCOUNT_ISSUE]: 'Account Issue',
    [TicketType.OTHER]: 'Other',
};

const sourceOptions: Record<string, string> = {
    [TicketSource.MANUAL]: 'Manual',
    [TicketSource.DISCORD]: 'Discord',
    [TicketSource.SLACK]: 'Slack',
    [TicketSource.TEAMS]: 'Teams',
    [TicketSource.GITHUB_ISSUE]: 'GitHub Issue',
    [TicketSource.GITHUB_DISCUSSION]: 'GitHub Discussion',
    [TicketSource.WEB]: 'Web',
    [TicketSource.EMAIL]: 'Email',
};

export function CreateTicketModal({ open, onClose, onCreated }: CreateTicketModalProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<string>(TicketPriority.MEDIUM);
    const [type, setType] = useState<string>(TicketType.QUESTION);
    const [source, setSource] = useState<string>(TicketSource.MANUAL);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

    // Focus trap and escape handling
    useEffect(() => {
        if (!open) return;

        // Focus title input on open
        requestAnimationFrame(() => {
            titleInputRef.current?.focus();
        });

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }

            // Simple focus trap
            if (e.key === 'Tab' && dialogRef.current) {
                const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                    'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
                );
                if (focusable.length === 0) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    // Reset form when modal opens
    useEffect(() => {
        if (open) {
            setTitle('');
            setDescription('');
            setPriority(TicketPriority.MEDIUM);
            setType(TicketType.QUESTION);
            setSource(TicketSource.MANUAL);
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    const handleSubmit = useCallback(async () => {
        if (!title.trim()) {
            setError('Title is required');
            return;
        }
        if (!description.trim()) {
            setError('Description is required');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const res = await fetch('/api/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim(),
                    priority,
                    type,
                    source,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || 'Failed to create ticket');
                return;
            }

            const ticket = await res.json();
            onCreated?.(ticket);
            onClose();
        } catch {
            setError('Failed to create ticket. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }, [title, description, priority, type, source, onClose, onCreated]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            data-testid="create-ticket-overlay"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Create new ticket"
                className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl"
                data-testid="create-ticket-modal"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <h2 className="text-lg font-semibold text-foreground">Create Ticket</h2>
                    <button
                        onClick={onClose}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label="Close"
                        data-testid="create-ticket-close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Form */}
                <div className="space-y-4 px-6 py-4">
                    {error && (
                        <div
                            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            data-testid="create-ticket-error"
                        >
                            {error}
                        </div>
                    )}

                    {/* Title */}
                    <div>
                        <label htmlFor="ticket-title" className="mb-1 block text-sm font-medium text-foreground">
                            Title <span className="text-destructive">*</span>
                        </label>
                        <input
                            ref={titleInputRef}
                            id="ticket-title"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Brief summary of the issue"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            data-testid="create-ticket-title"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label htmlFor="ticket-description" className="mb-1 block text-sm font-medium text-foreground">
                            Description <span className="text-destructive">*</span>
                        </label>
                        <textarea
                            id="ticket-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Detailed description of the issue or request"
                            rows={4}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                            data-testid="create-ticket-description"
                        />
                    </div>

                    {/* Dropdowns row */}
                    <div className="grid grid-cols-3 gap-3">
                        {/* Priority */}
                        <div>
                            <label htmlFor="ticket-priority" className="mb-1 block text-xs font-medium text-muted-foreground">
                                Priority
                            </label>
                            <select
                                id="ticket-priority"
                                value={priority}
                                onChange={(e) => setPriority(e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                data-testid="create-ticket-priority"
                            >
                                {Object.entries(priorityOptions).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Type */}
                        <div>
                            <label htmlFor="ticket-type" className="mb-1 block text-xs font-medium text-muted-foreground">
                                Type
                            </label>
                            <select
                                id="ticket-type"
                                value={type}
                                onChange={(e) => setType(e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                data-testid="create-ticket-type"
                            >
                                {Object.entries(typeOptions).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Source */}
                        <div>
                            <label htmlFor="ticket-source" className="mb-1 block text-xs font-medium text-muted-foreground">
                                Source
                            </label>
                            <select
                                id="ticket-source"
                                value={source}
                                onChange={(e) => setSource(e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                data-testid="create-ticket-source"
                            >
                                {Object.entries(sourceOptions).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
                    <button
                        onClick={onClose}
                        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                        data-testid="create-ticket-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className={cn(
                            'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                            submitting
                                ? 'bg-primary/50 text-primary-foreground/50 cursor-not-allowed'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90',
                        )}
                        data-testid="create-ticket-submit"
                    >
                        {submitting ? 'Creating...' : 'Create Ticket'}
                    </button>
                </div>
            </div>
        </div>
    );
}
