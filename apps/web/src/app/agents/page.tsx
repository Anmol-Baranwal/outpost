'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AgentTable } from '@/components/agents/agent-table';
import { MOCK_AGENTS, filterMockAgents } from '@/lib/mock-agents';
import type { MockAgent } from '@/lib/mock-agents';

export default function AgentsPage() {
    const router = useRouter();
    const [search, setSearch] = useState('');
    const [agents, setAgents] = useState<MockAgent[]>(MOCK_AGENTS);

    const filteredAgents = useMemo(() => {
        if (!search.trim()) return agents;
        const term = search.toLowerCase();
        return agents.filter(
            (a) =>
                a.name.toLowerCase().includes(term) ||
                (a.description && a.description.toLowerCase().includes(term)),
        );
    }, [agents, search]);

    const handleRun = useCallback((id: string) => {
        setAgents((prev) =>
            prev.map((a) =>
                a.id === id
                    ? { ...a, lastRun: new Date().toISOString(), status: 'ACTIVE' as const }
                    : a,
            ),
        );
    }, []);

    const handleEdit = useCallback(
        (id: string) => {
            router.push(`/agents/${id}/edit`);
        },
        [router],
    );

    const handleDelete = useCallback((id: string) => {
        setAgents((prev) => prev.filter((a) => a.id !== id));
    }, []);

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
                <AgentTable
                    agents={filteredAgents}
                    onRun={handleRun}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />
            </div>
        </div>
    );
}
