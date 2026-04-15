'use client';

import { useState, useMemo, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AccountsTable } from '@/components/accounts/accounts-table';
import { filterMockAccounts } from '@/lib/mock-accounts';
import type { AccountWithTicketCounts } from '@/lib/mock-accounts';

export default function AccountsPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [ownerOverrides, setOwnerOverrides] = useState<Record<string, string | null>>({});

    const accounts = useMemo(() => {
        const filtered = filterMockAccounts({ search: searchQuery || undefined });
        return filtered.map(account => ({
            ...account,
            ...(ownerOverrides[account.id] !== undefined
                ? { owner: ownerOverrides[account.id] }
                : {}),
        }));
    }, [searchQuery, ownerOverrides]);

    const handleOwnerChange = useCallback((accountId: string, owner: string | null) => {
        setOwnerOverrides(prev => ({ ...prev, [accountId]: owner }));
        // In production this would PATCH /api/accounts/:id
        fetch(`/api/accounts/${accountId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner }),
        }).catch(() => {
            // Revert on failure in production
        });
    }, []);

    return (
        <div>
            <PageHeader
                title="Accounts"
                description="Manage customer accounts, sentiment, and engagement."
                icon={Building2}
                breadcrumbs={[{ label: 'Accounts' }]}
            />
            <AccountsTable
                accounts={accounts}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onOwnerChange={handleOwnerChange}
            />
        </div>
    );
}
