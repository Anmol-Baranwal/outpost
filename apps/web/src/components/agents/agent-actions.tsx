'use client';

import { Play, Pencil, Trash2 } from 'lucide-react';

interface AgentActionsProps {
    agentId: string;
    onRun: (id: string) => void;
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
}

export function AgentActions({ agentId, onRun, onEdit, onDelete }: AgentActionsProps) {
    return (
        <div className="flex items-center gap-1">
            <button
                onClick={() => onRun(agentId)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Run Now"
                data-testid="agent-run-btn"
            >
                <Play className="h-4 w-4" />
            </button>
            <button
                onClick={() => onEdit(agentId)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Edit"
                data-testid="agent-edit-btn"
            >
                <Pencil className="h-4 w-4" />
            </button>
            <button
                onClick={() => onDelete(agentId)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                title="Delete"
                data-testid="agent-delete-btn"
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </div>
    );
}
