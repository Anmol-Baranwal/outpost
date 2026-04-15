import { PageHeader } from '@/components/page-header';

export default function TicketsPage() {
    return (
        <div>
            <PageHeader
                title="Tickets"
                description="Track and manage support tickets from all channels."
            />
            <div className="mb-4 flex items-center gap-4">
                <div className="flex gap-2">
                    {['All', 'Open', 'In Progress', 'Waiting', 'Resolved'].map((filter) => (
                        <button
                            key={filter}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            {filter}
                        </button>
                    ))}
                </div>
            </div>
            <div className="rounded-lg border border-gray-200">
                <div className="p-6 text-center text-sm text-gray-500">
                    Ticket list will be populated from the database.
                </div>
            </div>
        </div>
    );
}
