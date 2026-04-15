import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export default function BroadcastsPage() {
    return (
        <div>
            <PageHeader
                title="Broadcasts"
                description="Send targeted messages to accounts and user segments."
                icon={Megaphone}
                breadcrumbs={[{ label: 'Broadcasts' }]}
            />
            <div className="mb-6">
                <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                    New Broadcast
                </button>
            </div>
            <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-6 py-3">
                    <div className="grid grid-cols-4 text-sm font-medium text-muted-foreground">
                        <span>Message</span>
                        <span>Audience</span>
                        <span>Status</span>
                        <span>Created</span>
                    </div>
                </div>
                <div className="p-6 text-center text-sm text-muted-foreground">
                    No broadcasts yet. Create one to get started.
                </div>
            </div>
        </div>
    );
}
