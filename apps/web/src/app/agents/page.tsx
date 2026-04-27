'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Plus, Search, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AgentTable } from '@/components/agents/agent-table';
import type { Agent } from '@/components/agents/agent-table';

export default function AgentsPage() {
    const router = useRouter();
    const [search, setSearch] = useState('');
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchAgents = useCallback(async (searchTerm?: string) => {
        const url = searchTerm?.trim()
            ? `/api/agents?search=${encodeURIComponent(searchTerm.trim())}`
            : '/api/agents';
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            setAgents(data.agents);
        }
    }, []);

    useEffect(() => {
        fetchAgents(search).finally(() => setLoading(false));
    }, [fetchAgents, search]);

    const handleRun = useCallback(
        async (id: string) => {
            const res = await fetch(`/api/agents/${id}/run`, { method: 'POST' });
            if (res.ok) {
                await fetchAgents(search);
            }
        },
        [fetchAgents, search],
    );

    const handleEdit = useCallback(
        (id: string) => {
            router.push(`/agents/${id}/edit`);
        },
        [router],
    );

    const handleDelete = useCallback(
        async (id: string) => {
            const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await fetchAgents(search);
            }
        },
        [fetchAgents, search],
    );

    return (
        <div>
            <PageHeader
                title="Agents"
                description="Configure and monitor AI agents for automated support operations."
                icon={Bot}
                breadcrumbs={[{ label: 'Agents' }]}
            />

            {/* Toolbar */}
            <div className="mb-4 flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search agents..."
                        className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        data-testid="agent-search-input"
                    />
                </div>
                <button
                    onClick={() => router.push('/agents/new')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    data-testid="agent-create-btn"
                >
                    <Plus className="h-4 w-4" />
                    Create new agent
                </button>
            </div>

            {/* Table */}
            <div className="rounded-lg border border-border bg-card">
                {loading ? (
                    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                    </div>
                ) : (
                    <AgentTable
                        agents={agents}
                        onRun={handleRun}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                    />
                )}
            </div>
        </div>
    );
}
