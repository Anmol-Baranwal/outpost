'use client';

import { useState, forwardRef, useImperativeHandle, useRef } from 'react';
import {
    TicketStatus,
    TicketPriority,
    TicketType,
    TicketSource,
} from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import type { TicketDetail, TeamMember } from './types';
import { AddNoteForm } from './add-note-form';
import type { AddNoteFormHandle } from './add-note-form';

interface TicketSidebarProps {
    ticket: TicketDetail;
    onUpdate: (fields: Partial<TicketDetail>) => void;
    teamMembers: TeamMember[];
    className?: string;
}

const statusOptions: Record<string, string> = {
    [TicketStatus.OPEN]: 'Open',
    [TicketStatus.IN_PROGRESS]: 'In Progress',
    [TicketStatus.WAITING_ON_CUSTOMER]: 'Waiting (Customer)',
    [TicketStatus.WAITING_ON_TEAM]: 'Waiting (Team)',
    [TicketStatus.RESOLVED]: 'Resolved',
    [TicketStatus.CLOSED]: 'Closed',
};

const priorityOptions: Record<string, string> = {
    [TicketPriority.CRITICAL]: 'Critical',
    [TicketPriority.HIGH]: 'High',
    [TicketPriority.MEDIUM]: 'Medium',
    [TicketPriority.LOW]: 'Low',
};

const typeOptions: Record<string, string> = {
    [TicketType.BUG]: 'Bug',
    [TicketType.FEATURE_REQUEST]: 'Feature Request',
    [TicketType.QUESTION]: 'Question',
    [TicketType.INTEGRATION_HELP]: 'Integration Help',
    [TicketType.ACCOUNT_ISSUE]: 'Account Issue',
    [TicketType.OTHER]: 'Other',
};

const sourceLabels: Record<string, string> = {
    [TicketSource.DISCORD]: 'Discord',
    [TicketSource.SLACK]: 'Slack',
    [TicketSource.TEAMS]: 'Teams',
    [TicketSource.ORCA]: 'Orca',
    [TicketSource.GITHUB_ISSUE]: 'GitHub Issue',
    [TicketSource.GITHUB_DISCUSSION]: 'GitHub Discussion',
    [TicketSource.WEB]: 'Web',
    [TicketSource.EMAIL]: 'Email',
    [TicketSource.MANUAL]: 'Manual',
};

function FieldSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Record<string, string>;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-slate-500">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="text-xs bg-transparent border border-transparent hover:border-slate-200 rounded px-1.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer text-right"
            >
                {Object.entries(options).map(([val, display]) => (
                    <option key={val} value={val}>
                        {display}
                    </option>
                ))}
            </select>
        </div>
    );
}

function ExpandableSection({
    title,
    defaultOpen = false,
    isOpen: controlledOpen,
    onToggle,
    count,
    children,
    testId,
}: {
    title: string;
    defaultOpen?: boolean;
    isOpen?: boolean;
    onToggle?: () => void;
    count?: number;
    children: React.ReactNode;
    testId?: string;
}) {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const open = controlledOpen !== undefined ? controlledOpen : internalOpen;

    const handleToggle = () => {
        if (onToggle) {
            onToggle();
        } else {
            setInternalOpen(!internalOpen);
        }
    };

    return (
        <div className="border-t border-slate-100" data-testid={testId}>
            <button
                onClick={handleToggle}
                className="w-full flex items-center justify-between py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors"
                data-testid={testId ? `${testId}-toggle` : undefined}
            >
                <span>
                    {title}
                    {count !== undefined && count > 0 && (
                        <span className="ml-1 text-slate-400">({count})</span>
                    )}
                </span>
                <svg
                    className={cn('h-3 w-3 text-slate-400 transition-transform', open && 'rotate-180')}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && <div className="pb-2">{children}</div>}
        </div>
    );
}

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

export interface TicketSidebarHandle {
    openAddNote: () => void;
    toggleDiscussions: () => void;
}

export const TicketSidebar = forwardRef<TicketSidebarHandle, TicketSidebarProps>(
    function TicketSidebar({ ticket, onUpdate, teamMembers, className }, ref) {
    const [discussionsOpen, setDiscussionsOpen] = useState(false);
    const addNoteFormRef = useRef<AddNoteFormHandle>(null);

    useImperativeHandle(ref, () => ({
        openAddNote: () => {
            addNoteFormRef.current?.focus();
        },
        toggleDiscussions: () => {
            setDiscussionsOpen((prev) => !prev);
        },
    }));

    const handleNoteAdded = (note: { id: string; content: string; author: string; createdAt: string }) => {
        onUpdate({
            notes: [
                ...(ticket.notes ?? []),
                { ...note, ticketId: ticket.id },
            ],
        });
    };

    const discussions = ticket.discussions ?? [];

    return (
        <div className={cn('flex flex-col overflow-y-auto', className)} data-testid="ticket-sidebar">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-200">
                <span className="text-xs font-mono text-slate-400">{ticket.displayId}</span>
                <h3 className="text-sm font-medium text-slate-800 mt-0.5 leading-snug">
                    {ticket.title}
                </h3>
            </div>

            {/* Fields */}
            <div className="px-4 py-2">
                <div className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-slate-500">Assignee</span>
                    <select
                        value={ticket.assigneeId || ''}
                        onChange={(e) =>
                            onUpdate({
                                assigneeId: e.target.value || null,
                                assignee: teamMembers.find((tm) => tm.id === e.target.value) || null,
                            })
                        }
                        className="text-xs bg-transparent border border-transparent hover:border-slate-200 rounded px-1.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer text-right"
                    >
                        <option value="">Unassigned</option>
                        {teamMembers.map((tm) => (
                            <option key={tm.id} value={tm.id}>
                                {tm.name}
                            </option>
                        ))}
                    </select>
                </div>
                <FieldSelect
                    label="Status"
                    value={ticket.status}
                    options={statusOptions}
                    onChange={(v) => onUpdate({ status: v as TicketStatus })}
                />
                <FieldSelect
                    label="Priority"
                    value={ticket.priority}
                    options={priorityOptions}
                    onChange={(v) => onUpdate({ priority: v as TicketPriority })}
                />
                <FieldSelect
                    label="Type"
                    value={ticket.type}
                    options={typeOptions}
                    onChange={(v) => onUpdate({ type: v as TicketType })}
                />

                {/* Source */}
                <div className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-slate-500">Source</span>
                    <span className="text-xs text-slate-700">
                        {ticket.sourceUrl ? (
                            <a
                                href={ticket.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-700 hover:underline"
                            >
                                {sourceLabels[ticket.source]}
                            </a>
                        ) : (
                            sourceLabels[ticket.source]
                        )}
                    </span>
                </div>
            </div>

            {/* Additional Info */}
            {ticket.additionalInfo && Object.keys(ticket.additionalInfo).length > 0 && (
                <div className="px-4 py-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs font-medium text-slate-600">Additional Info</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">
                            AI
                        </span>
                    </div>
                    <div className="space-y-1">
                        {Object.entries(ticket.additionalInfo).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">{key}</span>
                                <span className="text-[10px] text-slate-600">{value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Expandable sections */}
            <div className="px-4">
                <ExpandableSection title="Notes" count={(ticket.notes ?? []).length} defaultOpen testId="notes-section">
                    {(ticket.notes ?? []).length > 0 && (
                        <div className="space-y-2 mb-2">
                            {(ticket.notes ?? []).map((note) => (
                                <div key={note.id} className="bg-yellow-50 rounded p-2">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className="text-[10px] font-medium text-slate-600">
                                            {note.author}
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                            {formatDate(note.createdAt)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-700">{note.content}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    <AddNoteForm
                        ref={addNoteFormRef}
                        ticketId={ticket.id}
                        onNoteAdded={handleNoteAdded}
                    />
                </ExpandableSection>

                <ExpandableSection
                    title="Discussions"
                    count={discussions.length}
                    isOpen={discussionsOpen}
                    onToggle={() => setDiscussionsOpen(!discussionsOpen)}
                    testId="discussions-section"
                >
                    {discussions.length > 0 ? (
                        <div className="space-y-2">
                            {discussions.map((d) => (
                                <div key={d.id} className="bg-slate-50 rounded p-2">
                                    <span className="text-xs font-medium text-slate-600">{d.title}</span>
                                    <span className="text-[10px] text-slate-400 ml-1">
                                        ({d.messages.length} message{d.messages.length !== 1 ? 's' : ''})
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-slate-400">No discussions yet.</p>
                    )}
                </ExpandableSection>

                <ExpandableSection title="Related Tickets" count={0}>
                    <p className="text-[10px] text-slate-400">No related tickets.</p>
                </ExpandableSection>
            </div>

            {/* Account info */}
            {ticket.account && (
                <div className="mt-auto px-4 py-3 border-t border-slate-200 bg-slate-50">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                        Account
                    </span>
                    <div className="mt-1.5 space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-700">
                                {ticket.account.name}
                            </span>
                        </div>
                        {ticket.user && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">User</span>
                                <span className="text-[10px] text-slate-600">{ticket.user.name}</span>
                            </div>
                        )}
                        {ticket.account.acv != null && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">ACV</span>
                                <span className="text-[10px] text-slate-600">
                                    {formatCurrency(ticket.account.acv)}
                                </span>
                            </div>
                        )}
                        {ticket.account.domain && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">Domain</span>
                                <span className="text-[10px] text-slate-600">
                                    {ticket.account.domain}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">Created</span>
                            <span className="text-[10px] text-slate-600">
                                {formatDate(ticket.account.createdAt)}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
