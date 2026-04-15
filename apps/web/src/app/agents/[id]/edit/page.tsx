'use client';

import { useRouter, useParams } from 'next/navigation';
import { Bot } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AgentForm } from '@/components/agents/agent-form';
import { findMockAgent } from '@/lib/mock-agents';
import type { AgentFormData } from '@/components/agents/agent-form';

export default function EditAgentPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const agent = findMockAgent(params.id);

    if (!agent) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Agent not found.
            </div>
        );
    }

    const handleSubmit = async (data: AgentFormData) => {
        // In production this would PATCH /api/agents/[id]
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
