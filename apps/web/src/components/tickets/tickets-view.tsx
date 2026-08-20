'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { TicketStatus, MessageType } from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import type { Ticket, TicketDetail, TicketMessage, TeamMember, Account } from './types';
import { TicketList } from './ticket-list';
import { TicketFilterPanel, DEFAULT_FILTERS } from './ticket-filters';
import type { TicketFilters } from './ticket-filters';
import { ConversationThread } from './conversation-thread';
import { ReplyEditor } from './reply-editor';
import type { ReplyEditorHandle } from './reply-editor';
import { TicketSidebar } from './ticket-sidebar';
import type { TicketSidebarHandle } from './ticket-sidebar';
import { CreateTicketModal } from './create-ticket-modal';
import { useTicketShortcuts } from '@/hooks/use-ticket-shortcuts';
import { apiFetch } from '@/lib/api-fetch';

interface TicketsViewProps {
    ticketId?: string;
}

export function TicketsView({ ticketId }: TicketsViewProps) {
    const router = useRouter();
    const [filters, setFilters] = useState<TicketFilters>(DEFAULT_FILTERS);
    const [mobilePanel, setMobilePanel] = useState<'list' | 'thread' | 'sidebar'>('list');
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const replyEditorRef = useRef<ReplyEditorHandle>(null);
    const sidebarRef = useRef<TicketSidebarHandle>(null);

    // Data state
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [ticketsLoading, setTicketsLoading] = useState(true);
    const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

    // Local ticket overrides for optimistic updates
    const [ticketOverrides, setTicketOverrides] = useState<Record<string, Partial<TicketDetail>>>(
        {},
    );
    const [error, setError] = useState<string | null>(null);

    // Fetch accounts and team members on mount
    useEffect(() => {
        apiFetch('/api/accounts')
            .then((res) => res.json())
            .then((data) => setAccounts(data.accounts ?? []))
            .catch(() => setAccounts([]));

        apiFetch('/api/team')
            .then((res) => {
                if (!res.ok) return [];
                return res.json();
            })
            .then((data) => setTeamMembers(Array.isArray(data) ? data : (data.members ?? [])))
            .catch(() => setTeamMembers([]));
    }, []);

    // Fetch tickets when filters change (server-side filtering)
    useEffect(() => {
        setTicketsLoading(true);
        const params = new URLSearchParams();

        if (filters.search) params.set('search', filters.search);
        if (filters.accountId) params.set('accountId', filters.accountId);
        if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
        for (const s of filters.status) params.append('status', s);
        for (const s of filters.source) params.append('source', s);
        for (const p of filters.priority) params.append('priority', p);
        for (const t of filters.type) params.append('type', t);
        params.set('page', '1');
        params.set('pageSize', '50');

        apiFetch(`/api/tickets?${params.toString()}`)
            .then((res) => res.json())
            .then((data) => {
                setTickets(data.tickets ?? []);
            })
            .catch(() => setTickets([]))
            .finally(() => setTicketsLoading(false));
    }, [filters]);

    // Fetch ticket detail when selection changes
    useEffect(() => {
        if (!ticketId) {
            setTicketDetail(null);
            return;
        }
        setDetailLoading(true);
        apiFetch(`/api/tickets/${ticketId}`)
            .then((res) => {
                if (!res.ok) throw new Error('Not found');
                return res.json();
            })
            .then((data) => setTicketDetail(data))
            .catch(() => setTicketDetail(null))
            .finally(() => setDetailLoading(false));
    }, [ticketId]);

    // Apply optimistic overrides to the list tickets
    const displayTickets = useMemo(() => {
        return tickets.map((t) => ({ ...t, ...ticketOverrides[t.id] }));
    }, [tickets, ticketOverrides]);

    // Merge detail with overrides
    const selectedTicket = useMemo(() => {
        if (!ticketDetail) return null;
        return { ...ticketDetail, ...ticketOverrides[ticketDetail.id] };
    }, [ticketDetail, ticketOverrides]);

    const currentIndex = useMemo(() => {
        if (!ticketId) return -1;
        return displayTickets.findIndex((t) => t.id === ticketId);
    }, [ticketId, displayTickets]);

    const navigateToTicket = useCallback(
        (id: string) => {
            router.push(`/tickets/${id}`);
            setMobilePanel('thread');
        },
        [router],
    );

    const handlePreviousTicket = useCallback(() => {
        if (currentIndex > 0) {
            navigateToTicket(displayTickets[currentIndex - 1].id);
        }
    }, [currentIndex, displayTickets, navigateToTicket]);

    const handleNextTicket = useCallback(() => {
        if (currentIndex < displayTickets.length - 1) {
            navigateToTicket(displayTickets[currentIndex + 1].id);
        }
    }, [currentIndex, displayTickets, navigateToTicket]);

    const handleMarkAsDone = useCallback(() => {
        if (!ticketId) return;
        let previousStatus: TicketDetail['status'] | undefined;
        setTicketOverrides((prev) => {
            previousStatus = prev[ticketId]?.status;
            return {
                ...prev,
                [ticketId]: {
                    ...prev[ticketId],
                    status: TicketStatus.CLOSED,
                },
            };
        });
        setError(null);
        apiFetch(`/api/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: TicketStatus.CLOSED }),
        })
            .then((res) => {
                if (!res.ok) throw new Error();
            })
            .catch(() => {
                setTicketOverrides((prev) => {
                    const restored = { ...prev, [ticketId]: { ...prev[ticketId] } };
                    if (previousStatus !== undefined) {
                        restored[ticketId].status = previousStatus;
                    } else {
                        delete restored[ticketId].status;
                    }
                    return restored;
                });
                setError('Failed to mark ticket as done. Please try again.');
            });
    }, [ticketId]);

    const handleCreateTicket = useCallback(() => {
        setCreateModalOpen(true);
    }, []);

    const handleAddNote = useCallback(() => {
        sidebarRef.current?.openAddNote();
    }, []);

    const handleToggleDiscussions = useCallback(() => {
        sidebarRef.current?.toggleDiscussions();
    }, []);

    const handleSendMessage = useCallback(
        (content: string) => {
            if (!selectedTicket) return;
            // Optimistic: add a temporary message locally
            const tempMessage: TicketMessage = {
                id: `msg-${Date.now()}`,
                ticketId: selectedTicket.id,
                author: 'You',
                content,
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: new Date().toISOString(),
                confidenceLevel: null,
            };
            setTicketOverrides((prev) => ({
                ...prev,
                [selectedTicket.id]: {
                    ...prev[selectedTicket.id],
                    messages: [
                        ...(prev[selectedTicket.id]?.messages ?? selectedTicket.messages),
                        tempMessage,
                    ],
                },
            }));
            // Persist to API
            apiFetch(`/api/tickets/${selectedTicket.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, type: MessageType.USER }),
            })
                .then((res) => {
                    if (res.ok) return res.json();
                    throw new Error('Failed to send');
                })
                .then((savedMessage) => {
                    // Replace temp message with the saved one
                    setTicketOverrides((prev) => {
                        const overrideMessages = prev[selectedTicket.id]?.messages;
                        if (!overrideMessages) return prev;
                        return {
                            ...prev,
                            [selectedTicket.id]: {
                                ...prev[selectedTicket.id],
                                messages: overrideMessages.map((m) =>
                                    m.id === tempMessage.id ? savedMessage : m,
                                ),
                            },
                        };
                    });
                })
                .catch(() => {
                    setTicketOverrides((prev) => {
                        const existing = prev[selectedTicket.id];
                        if (!existing?.messages) return prev;
                        return {
                            ...prev,
                            [selectedTicket.id]: {
                                ...existing,
                                messages: existing.messages.filter((m) => m.id !== tempMessage.id),
                            },
                        };
                    });
                    setError('Failed to send message. Please try again.');
                });
        },
        [selectedTicket],
    );

    const handleTicketUpdate = useCallback(
        (fields: Partial<TicketDetail>) => {
            if (!ticketId) return;
            let previousValues: Partial<TicketDetail> | undefined;
            setTicketOverrides((prev) => {
                const existing = prev[ticketId] ?? {};
                previousValues = {};
                for (const key of Object.keys(fields) as (keyof TicketDetail)[]) {
                    previousValues[key] = existing[key] as never;
                }
                return {
                    ...prev,
                    [ticketId]: { ...existing, ...fields },
                };
            });
            setError(null);
            const patchable: Record<string, unknown> = {};
            if ('status' in fields) patchable.status = fields.status;
            if ('priority' in fields) patchable.priority = fields.priority;
            if ('assigneeId' in fields) patchable.assigneeId = fields.assigneeId;
            if ('type' in fields) patchable.type = fields.type;

            if (Object.keys(patchable).length > 0) {
                apiFetch(`/api/tickets/${ticketId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patchable),
                })
                    .then((res) => {
                        if (!res.ok) throw new Error();
                    })
                    .catch(() => {
                        setTicketOverrides((prev) => {
                            const restored = { ...prev, [ticketId]: { ...prev[ticketId] } };
                            for (const key of Object.keys(fields) as (keyof TicketDetail)[]) {
                                if (previousValues && previousValues[key] !== undefined) {
                                    restored[ticketId][key] = previousValues[key] as never;
                                } else {
                                    delete restored[ticketId][key];
                                }
                            }
                            return restored;
                        });
                        setError('Failed to update ticket. Please try again.');
                    });
            }
        },
        [ticketId],
    );

    const handleTicketCreated = useCallback(
        (_ticket?: Record<string, unknown>) => {
            // Re-fetch the ticket list after creation
            const params = new URLSearchParams();
            if (filters.search) params.set('search', filters.search);
            if (filters.accountId) params.set('accountId', filters.accountId);
            if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
            for (const s of filters.status) params.append('status', s);
            for (const s of filters.source) params.append('source', s);
            for (const p of filters.priority) params.append('priority', p);
            for (const t of filters.type) params.append('type', t);
            params.set('page', '1');
            params.set('pageSize', '50');

            apiFetch(`/api/tickets?${params.toString()}`)
                .then((res) => res.json())
                .then((data) => setTickets(data.tickets ?? []))
                .catch(() => {});
        },
        [filters],
    );

    useTicketShortcuts({
        focusSearch: () => searchInputRef.current?.focus(),
        previousTicket: handlePreviousTicket,
        nextTicket: handleNextTicket,
        focusReply: () => replyEditorRef.current?.focus(),
        addNote: handleAddNote,
        markAsDone: handleMarkAsDone,
        createTicket: handleCreateTicket,
        toggleDiscussions: handleToggleDiscussions,
    });

    return (
        <div className="flex h-full relative" data-testid="tickets-view">
            {error && (
                <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    <span>{error}</span>
                    <button
                        onClick={() => setError(null)}
                        className="ml-4 text-xs font-medium text-destructive/80 hover:text-destructive"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            {/* Mobile tab bar */}
            <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card md:hidden">
                {(['list', 'thread', 'sidebar'] as const).map((panel) => (
                    <button
                        key={panel}
                        onClick={() => setMobilePanel(panel)}
                        className={cn(
                            'flex-1 py-2 text-xs font-medium capitalize transition-colors',
                            mobilePanel === panel
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground',
                        )}
                    >
                        {panel === 'thread' ? 'Conversation' : panel}
                    </button>
                ))}
            </div>

            {/* Left panel: ticket list */}
            <div
                className={cn(
                    'w-[250px] flex-shrink-0 border-r border-border flex flex-col bg-card',
                    'max-md:absolute max-md:inset-0 max-md:w-full max-md:z-40',
                    mobilePanel !== 'list' && 'max-md:hidden',
                )}
            >
                <TicketFilterPanel
                    filters={filters}
                    onFiltersChange={setFilters}
                    searchInputRef={searchInputRef}
                    accounts={accounts}
                    teamMembers={teamMembers}
                />
                {ticketsLoading ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        Loading...
                    </div>
                ) : (
                    <TicketList tickets={displayTickets} className="flex-1" />
                )}
            </div>

            {/* Center panel: conversation thread */}
            <div
                className={cn(
                    'flex-1 flex flex-col min-w-0 overflow-hidden bg-card',
                    'max-md:absolute max-md:inset-0 max-md:z-40',
                    mobilePanel !== 'thread' && 'max-md:hidden',
                )}
            >
                {detailLoading ? (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                        Loading...
                    </div>
                ) : selectedTicket ? (
                    <>
                        {/* Thread header */}
                        <div className="border-b border-border px-4 py-3 flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        router.push('/tickets');
                                        setMobilePanel('list');
                                    }}
                                    className="md:hidden text-xs text-primary"
                                >
                                    Back
                                </button>
                                <span className="text-xs font-mono text-muted-foreground">
                                    {selectedTicket.displayId}
                                </span>
                                <span
                                    className={cn(
                                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                                        selectedTicket.status === TicketStatus.OPEN &&
                                            'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                                        selectedTicket.status === TicketStatus.IN_PROGRESS &&
                                            'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                                        selectedTicket.status === TicketStatus.RESOLVED &&
                                            'bg-muted text-muted-foreground',
                                        selectedTicket.status === TicketStatus.CLOSED &&
                                            'bg-muted text-muted-foreground/80',
                                        (selectedTicket.status ===
                                            TicketStatus.WAITING_ON_CUSTOMER ||
                                            selectedTicket.status ===
                                                TicketStatus.WAITING_ON_TEAM) &&
                                            'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                                    )}
                                >
                                    {selectedTicket.status.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <h2 className="text-sm font-semibold text-foreground mt-0.5 break-words">
                                {selectedTicket.title}
                            </h2>
                        </div>
                        <ConversationThread messages={selectedTicket.messages} className="flex-1" />
                        <ReplyEditor
                            ref={replyEditorRef}
                            suggestedResponse={selectedTicket.suggestedResponse}
                            onSend={handleSendMessage}
                        />
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                        <div className="text-center">
                            <p className="text-lg mb-1 text-foreground">Select a ticket</p>
                            <p className="text-xs text-muted-foreground">
                                Choose a ticket from the list to view its conversation
                            </p>
                            <div className="mt-4 flex flex-wrap justify-center gap-2 text-[10px] text-muted-foreground">
                                <span className="bg-muted px-2 py-1 rounded font-mono">J</span> next
                                <span className="bg-muted px-2 py-1 rounded font-mono">F</span> prev
                                <span className="bg-muted px-2 py-1 rounded font-mono">/</span>{' '}
                                search
                                <span className="bg-muted px-2 py-1 rounded font-mono">C</span>{' '}
                                create
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right panel: ticket sidebar */}
            {selectedTicket && (
                <div
                    className={cn(
                        'w-[300px] flex-shrink-0 border-l border-border bg-card',
                        'max-md:absolute max-md:inset-0 max-md:w-full max-md:z-40',
                        mobilePanel !== 'sidebar' && 'max-md:hidden',
                    )}
                >
                    <TicketSidebar
                        ref={sidebarRef}
                        ticket={selectedTicket}
                        onUpdate={handleTicketUpdate}
                        teamMembers={teamMembers}
                    />
                </div>
            )}

            {/* Create ticket modal */}
            <CreateTicketModal
                open={createModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onCreated={handleTicketCreated}
            />
        </div>
    );
}
