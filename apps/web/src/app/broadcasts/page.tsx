import { PageHeader } from '@/components/page-header';

export default function BroadcastsPage() {
    return (
        <div>
            <PageHeader
                title="Broadcasts"
                description="Send targeted messages to accounts and user segments."
            />
            <div className="mb-6">
                <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                    New Broadcast
                </button>
            </div>
            <div className="rounded-lg border border-gray-200">
                <div className="border-b border-gray-200 px-6 py-3">
                    <div className="grid grid-cols-4 text-sm font-medium text-gray-500">
                        <span>Message</span>
                        <span>Audience</span>
                        <span>Status</span>
                        <span>Created</span>
                    </div>
                </div>
                <div className="p-6 text-center text-sm text-gray-500">
                    No broadcasts yet. Create one to get started.
                </div>
            </div>
        </div>
    );
}
