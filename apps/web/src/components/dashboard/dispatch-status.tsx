'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface TeamMember {
    id: string;
    name: string;
    role: string;
}

interface AssignedTicket {
    id: string;
    displayId: string;
    title: string;
    priority: string;
    status: string;
    assigneeId: string | null;
}

interface DispatchStatusProps {
    tickets: AssignedTicket[];
    teamMembers: TeamMember[];
    onAssign?: (ticketId: string, memberId: string) => void;
}

// ─── Priority Badge ────────────────────────────────────────────────────────

const priorityColors: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-800',
    HIGH: 'bg-orange-100 text-orange-800',
    MEDIUM: 'bg-yellow-100 text-yellow-800',
    LOW: 'bg-green-100 text-green-800',
};

function PriorityBadge({ priority }: { priority: string }) {
    const colorClass = priorityColors[priority] ?? 'bg-gray-100 text-gray-800';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
            {priority}
        </span>
    );
}

// ─── Dispatch Status Widget ────────────────────────────────────────────────

/**
 * Dashboard widget showing ticket assignments per team member
 * and highlighting unassigned escalations with quick-assign capability.
 */
export function DispatchStatus({ tickets, teamMembers, onAssign }: DispatchStatusProps) {
    const [assigningTicketId, setAssigningTicketId] = useState<string | null>(null);

    const unassignedTickets = tickets.filter((t) => !t.assigneeId);
    const assignedByMember = new Map<string, AssignedTicket[]>();

    for (const member of teamMembers) {
        assignedByMember.set(member.id, []);
    }
    for (const ticket of tickets) {
        if (ticket.assigneeId) {
            const existing = assignedByMember.get(ticket.assigneeId) ?? [];
            existing.push(ticket);
            assignedByMember.set(ticket.assigneeId, existing);
        }
    }

    const handleAssign = useCallback(
        (ticketId: string, memberId: string) => {
            onAssign?.(ticketId, memberId);
            setAssigningTicketId(null);
        },
        [onAssign],
    );

    return (
        <div className="space-y-6">
            {/* Unassigned Escalations */}
            {unassignedTickets.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <h3 className="text-sm font-semibold text-red-800 mb-3">
                        Unassigned Escalations ({unassignedTickets.length})
                    </h3>
                    <ul className="space-y-2">
                        {unassignedTickets.map((ticket) => (
                            <li
                                key={ticket.id}
                                className="flex items-center justify-between bg-white rounded p-2 shadow-sm"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <PriorityBadge priority={ticket.priority} />
                                    <span className="text-xs text-gray-500 font-mono">
                                        {ticket.displayId}
                                    </span>
                                    <span className="text-sm text-gray-900 truncate">
                                        {ticket.title}
                                    </span>
                                </div>
                                <div className="flex-shrink-0 ml-2">
                                    {assigningTicketId === ticket.id ? (
                                        <select
                                            className="text-xs border rounded px-2 py-1"
                                            defaultValue=""
                                            onChange={(e) => {
                                                if (e.target.value) {
                                                    handleAssign(ticket.id, e.target.value);
                                                }
                                            }}
                                            onBlur={() => setAssigningTicketId(null)}
                                            autoFocus
                                        >
                                            <option value="" disabled>
                                                Select member...
                                            </option>
                                            {teamMembers.map((m) => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name} ({m.role})
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <button
                                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                            onClick={() => setAssigningTicketId(ticket.id)}
                                        >
                                            Assign
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Per-Member Assignment Counts */}
            <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    Assignments by Team Member
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {teamMembers.map((member) => {
                        const memberTickets = assignedByMember.get(member.id) ?? [];
                        return (
                            <div
                                key={member.id}
                                className="rounded-lg border bg-white p-3 shadow-sm"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <span className="text-sm font-medium text-gray-900">
                                            {member.name}
                                        </span>
                                        <span className="ml-1 text-xs text-gray-500">
                                            ({member.role})
                                        </span>
                                    </div>
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
                                        {memberTickets.length}
                                    </span>
                                </div>
                                {memberTickets.length > 0 ? (
                                    <ul className="space-y-1">
                                        {memberTickets.slice(0, 5).map((ticket) => (
                                            <li
                                                key={ticket.id}
                                                className="flex items-center gap-1 text-xs text-gray-600"
                                            >
                                                <PriorityBadge priority={ticket.priority} />
                                                <span className="font-mono">
                                                    {ticket.displayId}
                                                </span>
                                                <span className="truncate">{ticket.title}</span>
                                            </li>
                                        ))}
                                        {memberTickets.length > 5 && (
                                            <li className="text-xs text-gray-400">
                                                +{memberTickets.length - 5} more
                                            </li>
                                        )}
                                    </ul>
                                ) : (
                                    <p className="text-xs text-gray-400 italic">
                                        No assigned tickets
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
