'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { TicketStatus, MessageType } from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import { MOCK_TICKETS, filterMockTickets, findMockTicket } from '@/lib/mock-tickets';
import type { MockTicket, MockMessage } from '@/lib/mock-tickets';
import { TicketList } from './ticket-list';
import { TicketFilterPanel, DEFAULT_FILTERS } from './ticket-filters';
import type { TicketFilters } from './ticket-filters';
import { ConversationThread } from './conversation-thread';
import { ReplyEditor } from './reply-editor';
import type { ReplyEditorHandle } from './reply-editor';
import { TicketSidebar } from './ticket-sidebar';
import { useTicketShortcuts } from '@/hooks/use-ticket-shortcuts';

interface TicketsViewProps {
    ticketId?: string;
}

export function TicketsView({ ticketId }: TicketsViewProps) {
    const router = useRouter();
    const [filters, setFilters] = useState<TicketFilters>(DEFAULT_FILTERS);
    const [mobilePanel, setMobilePanel] = useState<'list' | 'thread' | 'sidebar'>('list');
    const searchInputRef = useRef<HTMLInputElement>(null);
    const replyEditorRef = useRef<ReplyEditorHandle>(null);

    // Local ticket state (for mock updates)
    const [ticketOverrides, setTicketOverrides] = useState<Record<string, Partial<MockTicket>>>({});

    const filteredTickets = useMemo(() => {
        const base = filterMockTickets(filters);
        return base.map((t) => ({ ...t, ...ticketOverrides[t.id] }));
    }, [filters, ticketOverrides]);

    const selectedTicket = useMemo(() => {
        if (!ticketId) return null;
        const base = findMockTicket(ticketId);
        if (!base) return null;
        return { ...base, ...ticketOverrides[base.id] };
    }, [ticketId, ticketOverrides]);

    const currentIndex = useMemo(() => {
        if (!ticketId) return -1;
        return filteredTickets.findIndex((t) => t.id === ticketId);
    }, [ticketId, filteredTickets]);

    const navigateToTicket = useCallback(
        (id: string) => {
            router.push(`/tickets/${id}`);
            setMobilePanel('thread');
        },
        [router],
    );

    const handlePreviousTicket = useCallback(() => {
        if (currentIndex > 0) {
            navigateToTicket(filteredTickets[currentIndex - 1].id);
        }
    }, [currentIndex, filteredTickets, navigateToTicket]);

    const handleNextTicket = useCallback(() => {
        if (currentIndex < filteredTickets.length - 1) {
            navigateToTicket(filteredTickets[currentIndex + 1].id);
        }
    }, [currentIndex, filteredTickets, navigateToTicket]);

    const handleMarkAsDone = useCallback(() => {
        if (!ticketId) return;
        setTicketOverrides((prev) => ({
            ...prev,
            [ticketId]: {
                ...prev[ticketId],
                status: TicketStatus.CLOSED,
            },
        }));
    }, [ticketId]);

    const handleCreateTicket = useCallback(() => {
        // Placeholder: in production this would open a modal
        console.log('Create ticket');
    }, []);

    const handleAddNote = useCallback(() => {
        // Placeholder: in production this would open a note input
        console.log('Add note');
    }, []);

    const handleSendMessage = useCallback(
        (content: string) => {
            if (!selectedTicket) return;
            const newMessage: MockMessage = {
                id: `msg-${Date.now()}`,
                ticketId: selectedTicket.id,
                author: 'You',
                content,
                type: MessageType.USER,
                isAiGenerated: false,
                attachments: null,
                createdAt: new Date().toISOString(),
            };
            setTicketOverrides((prev) => ({
                ...prev,
                [selectedTicket.id]: {
                    ...prev[selectedTicket.id],
                    messages: [...(prev[selectedTicket.id]?.messages ?? selectedTicket.messages), newMessage],
                },
            }));
        },
        [selectedTicket],
    );

    const handleTicketUpdate = useCallback(
        (fields: Partial<MockTicket>) => {
            if (!ticketId) return;
            setTicketOverrides((prev) => ({
                ...prev,
                [ticketId]: { ...prev[ticketId], ...fields },
            }));
        },
        [ticketId],
    );

    useTicketShortcuts({
        focusSearch: () => searchInputRef.current?.focus(),
        previousTicket: handlePreviousTicket,
        nextTicket: handleNextTicket,
        focusReply: () => replyEditorRef.current?.focus(),
        addNote: handleAddNote,
        markAsDone: handleMarkAsDone,
        createTicket: handleCreateTicket,
    });

    return (
        <div className="flex h-full" data-testid="tickets-view">
            {/* Mobile tab bar */}
            <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-slate-200 bg-white md:hidden">
                {(['list', 'thread', 'sidebar'] as const).map((panel) => (
                    <button
                        key={panel}
                        onClick={() => setMobilePanel(panel)}
                        className={cn(
                            'flex-1 py-2 text-xs font-medium capitalize transition-colors',
                            mobilePanel === panel
                                ? 'text-blue-600 bg-blue-50'
                                : 'text-slate-500',
                        )}
                    >
                        {panel === 'thread' ? 'Conversation' : panel}
                    </button>
                ))}
            </div>

            {/* Left panel: ticket list */}
            <div
                className={cn(
                    'w-[250px] flex-shrink-0 border-r border-slate-200 flex flex-col bg-white',
                    'max-md:absolute max-md:inset-0 max-md:w-full max-md:z-40',
                    mobilePanel !== 'list' && 'max-md:hidden',
                )}
            >
                <TicketFilterPanel
                    filters={filters}
                    onFiltersChange={setFilters}
                    searchInputRef={searchInputRef}
                />
                <TicketList tickets={filteredTickets} className="flex-1" />
            </div>

            {/* Center panel: conversation thread */}
            <div
                className={cn(
                    'flex-1 flex flex-col min-w-0 bg-white',
                    'max-md:absolute max-md:inset-0 max-md:z-40',
                    mobilePanel !== 'thread' && 'max-md:hidden',
                )}
            >
                {selectedTicket ? (
                    <>
                        {/* Thread header */}
                        <div className="border-b border-slate-200 px-4 py-3 flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        router.push('/tickets');
                                        setMobilePanel('list');
                                    }}
                                    className="md:hidden text-xs text-blue-600"
                                >
                                    Back
                                </button>
                                <span className="text-xs font-mono text-slate-400">
                                    {selectedTicket.displayId}
                                </span>
                                <span
                                    className={cn(
                                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                                        selectedTicket.status === TicketStatus.OPEN && 'bg-green-100 text-green-700',
                                        selectedTicket.status === TicketStatus.IN_PROGRESS && 'bg-blue-100 text-blue-700',
                                        selectedTicket.status === TicketStatus.RESOLVED && 'bg-slate-100 text-slate-600',
                                        selectedTicket.status === TicketStatus.CLOSED && 'bg-slate-100 text-slate-500',
                                        (selectedTicket.status === TicketStatus.WAITING_ON_CUSTOMER ||
                                            selectedTicket.status === TicketStatus.WAITING_ON_TEAM) &&
                                            'bg-yellow-100 text-yellow-700',
                                    )}
                                >
                                    {selectedTicket.status.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <h2 className="text-sm font-semibold text-slate-800 mt-0.5">
                                {selectedTicket.title}
                            </h2>
                        </div>
                        <ConversationThread
                            messages={selectedTicket.messages}
                            className="flex-1"
                        />
                        <ReplyEditor
                            ref={replyEditorRef}
                            suggestedResponse={selectedTicket.suggestedResponse}
                            onSend={handleSendMessage}
                        />
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-slate-400">
                        <div className="text-center">
                            <p className="text-lg mb-1">Select a ticket</p>
                            <p className="text-xs text-slate-400">
                                Choose a ticket from the list to view its conversation
                            </p>
                            <div className="mt-4 flex flex-wrap justify-center gap-2 text-[10px] text-slate-400">
                                <span className="bg-slate-50 px-2 py-1 rounded font-mono">J</span> next
                                <span className="bg-slate-50 px-2 py-1 rounded font-mono">F</span> prev
                                <span className="bg-slate-50 px-2 py-1 rounded font-mono">/</span> search
                                <span className="bg-slate-50 px-2 py-1 rounded font-mono">C</span> create
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right panel: ticket sidebar */}
            {selectedTicket && (
                <div
                    className={cn(
                        'w-[300px] flex-shrink-0 border-l border-slate-200 bg-white',
                        'max-md:absolute max-md:inset-0 max-md:w-full max-md:z-40',
                        mobilePanel !== 'sidebar' && 'max-md:hidden',
                    )}
                >
                    <TicketSidebar
                        ticket={selectedTicket}
                        onUpdate={handleTicketUpdate}
                    />
                </div>
            )}
        </div>
    );
}
