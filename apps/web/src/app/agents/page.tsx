import { Bot } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export default function AgentsPage() {
    return (
        <div>
            <PageHeader
                title="Agents"
                description="Configure and monitor AI agents for automated support operations."
                icon={Bot}
                breadcrumbs={[{ label: 'Agents' }]}
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                <AgentCard
                    name="Auto-Responder"
                    description="Automatically responds to common questions using the knowledge base"
                    status="active"
                />
                <AgentCard
                    name="SLA Monitor"
                    description="Monitors tickets approaching SLA breach and alerts the team"
                    status="active"
                />
                <AgentCard
                    name="Sentiment Analyzer"
                    description="Analyzes customer messages to update account sentiment scores"
                    status="paused"
                />
            </div>
        </div>
    );
}

function AgentCard({
    name,
    description,
    status,
}: {
    name: string;
    description: string;
    status: 'active' | 'paused' | 'error';
}) {
    const statusColors = {
        active: 'bg-green-500/10 text-green-400',
        paused: 'bg-yellow-500/10 text-yellow-400',
        error: 'bg-red-500/10 text-red-400',
    };

    return (
        <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-card-foreground">{name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status]}`}>
                    {status}
                </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <div className="mt-4 flex gap-2">
                <button className="rounded-md border border-input px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
                    Configure
                </button>
                <button className="rounded-md border border-input px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
                    View Logs
                </button>
            </div>
        </div>
    );
}
