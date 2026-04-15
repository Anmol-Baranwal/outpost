import { Ticket } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export default function TicketsPage() {
    return (
        <div>
            <PageHeader
                title="Tickets"
                description="Track and manage support tickets from all channels."
                icon={Ticket}
                breadcrumbs={[{ label: 'Tickets' }]}
            />
            <div className="mb-4 flex items-center gap-4">
                <div className="flex gap-2">
                    {['All', 'Open', 'In Progress', 'Waiting', 'Resolved'].map((filter) => (
                        <button
                            key={filter}
                            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                        >
                            {filter}
                        </button>
                    ))}
                </div>
            </div>
            <div className="rounded-lg border border-border bg-card">
                <div className="p-6 text-center text-sm text-muted-foreground">
                    Ticket list will be populated from the database.
                </div>
            </div>
        </div>
    );
}
