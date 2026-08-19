'use client';

import { useRouter } from 'next/navigation';
import { Bot } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AgentForm } from '@/components/agents/agent-form';
import type { AgentFormData } from '@/components/agents/agent-form';
import { apiFetch } from '@/lib/api-fetch';

export default function NewAgentPage() {
    const router = useRouter();

    const handleSubmit = async (data: AgentFormData) => {
        // In production this would POST to /api/agents
        const res = await apiFetch('/api/agents', {
            method: 'POST',
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
                title="Create Agent"
                description="Set up a new automated agent for your support operations."
                icon={Bot}
                breadcrumbs={[
                    { label: 'Agents', href: '/agents' },
                    { label: 'New Agent' },
                ]}
            />
            <div className="max-w-xl rounded-lg border border-border bg-card p-6">
                <AgentForm onSubmit={handleSubmit} onCancel={() => router.push('/agents')} />
            </div>
        </div>
    );
}
