'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Bot, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AgentForm } from '@/components/agents/agent-form';
import type { AgentFormData } from '@/components/agents/agent-form';
import type { Agent } from '@/components/agents/agent-table';

export default function EditAgentPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const [agent, setAgent] = useState<Agent | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/agents/${params.id}`)
            .then(async (res) => {
                if (res.ok) {
                    setAgent(await res.json());
                }
            })
            .finally(() => setLoading(false));
    }, [params.id]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
            </div>
        );
    }

    if (!agent) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Agent not found.
            </div>
        );
    }

    const handleSubmit = async (data: AgentFormData) => {
        const res = await fetch(`/api/agents/${params.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (res.ok) {
            router.push('/agents');
        }
    };

    return (
        <div>
            <PageHeader
                title={`Edit ${agent.name}`}
                description="Update this agent's configuration."
                icon={Bot}
                breadcrumbs={[
                    { label: 'Agents', href: '/agents' },
                    { label: agent.name },
                ]}
            />
            <div className="max-w-xl rounded-lg border border-border bg-card p-6">
                <AgentForm
                    agent={agent}
                    onSubmit={handleSubmit}
                    onCancel={() => router.push('/agents')}
                />
            </div>
        </div>
    );
}
