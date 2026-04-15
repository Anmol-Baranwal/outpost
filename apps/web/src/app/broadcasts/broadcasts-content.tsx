'use client';

import { useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { BroadcastList } from '@/components/broadcasts/broadcast-list';
import { BroadcastComposer } from '@/components/broadcasts/broadcast-composer';
import { filterMockBroadcasts } from '@/lib/mock-broadcasts';
import type { BroadcastStatus } from '@/lib/mock-broadcasts';
import type { BroadcastFormData } from '@/components/broadcasts/broadcast-composer';

export default function BroadcastsContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const showComposer = searchParams.get('action') === 'create';

    const [statusFilter, setStatusFilter] = useState<BroadcastStatus | null>(null);

    const broadcasts = filterMockBroadcasts(
        statusFilter ? { status: statusFilter } : {},
    );

    const openComposer = useCallback(() => {
        router.push('/broadcasts?action=create');
    }, [router]);

    const closeComposer = useCallback(() => {
        router.push('/broadcasts');
    }, [router]);

    const handleSend = useCallback(
        (_data: BroadcastFormData) => {
            closeComposer();
        },
        [closeComposer],
    );

    const handleSaveDraft = useCallback(
        (_data: BroadcastFormData) => {
            closeComposer();
        },
        [closeComposer],
    );

    return (
        <div>
            <PageHeader
                title="Broadcasts"
                description="Send targeted messages to accounts and user segments."
                icon={Megaphone}
                breadcrumbs={[{ label: 'Broadcasts' }]}
            />

            {showComposer ? (
                <div className="mb-6 rounded-lg border border-border bg-card p-6">
                    <h2 className="mb-4 text-lg font-semibold text-foreground">
                        New Broadcast
                    </h2>
                    <BroadcastComposer
                        onSend={handleSend}
                        onSaveDraft={handleSaveDraft}
                        onCancel={closeComposer}
                    />
                </div>
            ) : (
                <div className="mb-6">
                    <button
                        onClick={openComposer}
                        data-testid="new-broadcast-button"
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                        New Broadcast
                    </button>
                </div>
            )}

            <BroadcastList
                broadcasts={broadcasts}
                onStatusFilter={setStatusFilter}
                activeFilter={statusFilter}
            />
        </div>
    );
}
