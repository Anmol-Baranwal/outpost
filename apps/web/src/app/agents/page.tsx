import { PageHeader } from '@/components/page-header';

export default function AgentsPage() {
    return (
        <div>
            <PageHeader
                title="Agents"
                description="Configure and monitor AI agents for automated support operations."
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
        active: 'bg-green-100 text-green-800',
        paused: 'bg-yellow-100 text-yellow-800',
        error: 'bg-red-100 text-red-800',
    };

    return (
        <div className="rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status]}`}>
                    {status}
                </span>
            </div>
            <p className="mt-2 text-sm text-gray-500">{description}</p>
            <div className="mt-4 flex gap-2">
                <button className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Configure
                </button>
                <button className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    View Logs
                </button>
            </div>
        </div>
    );
}
