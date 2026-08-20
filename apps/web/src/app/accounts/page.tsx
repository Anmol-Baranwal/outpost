'use client';

import { useState, useEffect, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AccountsTable } from '@/components/accounts/accounts-table';
import type { AccountSentiment, AccountEngagement } from '@copilotkit/outpost/shared';
import { apiFetch } from '@/lib/api-fetch';

interface AccountWithTicketCounts {
    id: string;
    name: string;
    domain: string | null;
    owner: string | null;
    sentiment: AccountSentiment;
    engagement: AccountEngagement;
    acv: number | null;
    closeDate: string | null;
    createdAt: string;
    updatedAt: string;
    openTickets: number;
    inProgressTickets: number;
    closedTickets: number;
}

export default function AccountsPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [accounts, setAccounts] = useState<AccountWithTicketCounts[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams();
        if (searchQuery) {
            params.set('search', searchQuery);
        }

        const url = `/api/accounts${params.toString() ? `?${params.toString()}` : ''}`;

        // Debounce search requests
        const timer = setTimeout(() => {
            apiFetch(url)
                .then(res => res.json())
                .then(data => {
                    setAccounts(data.accounts ?? []);
                    setLoading(false);
                })
                .catch(() => {
                    setAccounts([]);
                    setLoading(false);
                });
        }, 200);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleOwnerChange = useCallback((accountId: string, owner: string | null) => {
        // Optimistic update
        setAccounts(prev =>
            prev.map(a => a.id === accountId ? { ...a, owner } : a),
        );

        apiFetch(`/api/accounts/${accountId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner }),
        }).catch(() => {
            // Revert on failure — refetch
            apiFetch(`/api/accounts?${searchQuery ? `search=${searchQuery}` : ''}`)
                .then(res => res.json())
                .then(data => setAccounts(data.accounts ?? []));
        });
    }, [searchQuery]);

    return (
        <div>
            <PageHeader
                title="Accounts"
                description="Manage customer accounts, sentiment, and engagement."
                icon={Building2}
                breadcrumbs={[{ label: 'Accounts' }]}
            />
            {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                    Loading accounts...
                </div>
            ) : (
                <AccountsTable
                    accounts={accounts}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onOwnerChange={handleOwnerChange}
                />
            )}
        </div>
    );
}
