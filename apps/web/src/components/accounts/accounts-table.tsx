'use client';

import { useState, useMemo, useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountWithTicketCounts } from '@/lib/mock-accounts';
import { SentimentBadge } from './sentiment-badge';
import { EngagementBadge } from './engagement-badge';
import { AccountOwnerSelect } from './account-owner-select';

interface AccountsTableProps {
    accounts: AccountWithTicketCounts[];
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onOwnerChange: (accountId: string, owner: string | null) => void;
}

type SortField = 'name' | 'owner' | 'sentiment' | 'engagement' | 'openTickets' | 'inProgressTickets' | 'closedTickets' | 'acv' | 'closeDate';
type SortDirection = 'asc' | 'desc';

interface SortState {
    field: SortField;
    direction: SortDirection;
}

const COLUMN_HEADERS: { field: SortField; label: string; align?: 'right' }[] = [
    { field: 'name', label: 'Account' },
    { field: 'owner', label: 'Owner' },
    { field: 'sentiment', label: 'Sentiment' },
    { field: 'engagement', label: 'Engagement' },
    { field: 'openTickets', label: 'Open', align: 'right' },
    { field: 'inProgressTickets', label: 'In Progress', align: 'right' },
    { field: 'closedTickets', label: 'Closed', align: 'right' },
    { field: 'acv', label: 'ACV', align: 'right' },
    { field: 'closeDate', label: 'Close Date' },
];

function formatCurrency(value: number | null): string {
    if (value == null) return '--';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

function formatDate(value: string | null): string {
    if (!value) return '--';
    return new Date(value).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function sortAccounts(
    accounts: AccountWithTicketCounts[],
    sort: SortState,
): AccountWithTicketCounts[] {
    const sorted = [...accounts];
    const dir = sort.direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
        const aVal = a[sort.field];
        const bVal = b[sort.field];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal) * dir;
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return (aVal - bVal) * dir;
        }
        return 0;
    });

    return sorted;
}

export function AccountsTable({
    accounts,
    searchQuery,
    onSearchChange,
    onOwnerChange,
}: AccountsTableProps) {
    const [sort, setSort] = useState<SortState>({ field: 'name', direction: 'asc' });

    const sortedAccounts = useMemo(
        () => sortAccounts(accounts, sort),
        [accounts, sort],
    );

    const handleSort = useCallback((field: SortField) => {
        setSort(prev => ({
            field,
            direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
        }));
    }, []);

    function SortIcon({ field }: { field: SortField }) {
        if (sort.field !== field) {
            return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
        }
        return sort.direction === 'asc'
            ? <ArrowUp className="h-3 w-3" />
            : <ArrowDown className="h-3 w-3" />;
    }

    return (
        <div className="rounded-lg border border-border bg-card" data-testid="accounts-table">
            {/* Search bar */}
            <div className="border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search accounts..."
                            value={searchQuery}
                            onChange={e => onSearchChange(e.target.value)}
                            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            data-testid="accounts-search"
                        />
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {sortedAccounts.length} account{sortedAccounts.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted/50">
                            {COLUMN_HEADERS.map(col => (
                                <th
                                    key={col.field}
                                    className={cn(
                                        'px-4 py-2 font-medium text-muted-foreground whitespace-nowrap',
                                        col.align === 'right' ? 'text-right' : 'text-left',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSort(col.field)}
                                        className={cn(
                                            'inline-flex items-center gap-1 hover:text-foreground transition-colors',
                                            col.align === 'right' && 'flex-row-reverse',
                                        )}
                                        data-testid={`sort-${col.field}`}
                                    >
                                        {col.label}
                                        <SortIcon field={col.field} />
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedAccounts.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={COLUMN_HEADERS.length}
                                    className="px-4 py-8 text-center text-muted-foreground"
                                >
                                    No accounts match the current search.
                                </td>
                            </tr>
                        ) : (
                            sortedAccounts.map(account => (
                                <tr
                                    key={account.id}
                                    className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                                    data-testid={`account-row-${account.id}`}
                                >
                                    {/* Account name + domain */}
                                    <td className="px-4 py-3">
                                        <div>
                                            <span className="font-medium text-foreground">
                                                {account.name}
                                            </span>
                                            {account.domain && (
                                                <span className="ml-2 text-xs text-muted-foreground">
                                                    {account.domain}
                                                </span>
                                            )}
                                        </div>
                                    </td>

                                    {/* Owner */}
                                    <td className="px-4 py-3">
                                        <AccountOwnerSelect
                                            value={account.owner}
                                            onChange={owner => onOwnerChange(account.id, owner)}
                                        />
                                    </td>

                                    {/* Sentiment */}
                                    <td className="px-4 py-3">
                                        <SentimentBadge sentiment={account.sentiment} />
                                    </td>

                                    {/* Engagement */}
                                    <td className="px-4 py-3">
                                        <EngagementBadge engagement={account.engagement} />
                                    </td>

                                    {/* Open tickets */}
                                    <td className="px-4 py-3 text-right">
                                        {account.openTickets > 0 ? (
                                            <a
                                                href={`/tickets?accountId=${account.id}&status=OPEN&status=WAITING_ON_CUSTOMER&status=WAITING_ON_TEAM`}
                                                className="text-blue-600 hover:underline font-medium"
                                                data-testid={`open-tickets-link-${account.id}`}
                                            >
                                                {account.openTickets}
                                            </a>
                                        ) : (
                                            <span className="text-muted-foreground">0</span>
                                        )}
                                    </td>

                                    {/* In Progress tickets */}
                                    <td className="px-4 py-3 text-right">
                                        {account.inProgressTickets > 0 ? (
                                            <a
                                                href={`/tickets?accountId=${account.id}&status=IN_PROGRESS`}
                                                className="text-blue-600 hover:underline font-medium"
                                                data-testid={`in-progress-tickets-link-${account.id}`}
                                            >
                                                {account.inProgressTickets}
                                            </a>
                                        ) : (
                                            <span className="text-muted-foreground">0</span>
                                        )}
                                    </td>

                                    {/* Closed tickets */}
                                    <td className="px-4 py-3 text-right">
                                        {account.closedTickets > 0 ? (
                                            <a
                                                href={`/tickets?accountId=${account.id}&status=RESOLVED&status=CLOSED`}
                                                className="text-blue-600 hover:underline font-medium"
                                                data-testid={`closed-tickets-link-${account.id}`}
                                            >
                                                {account.closedTickets}
                                            </a>
                                        ) : (
                                            <span className="text-muted-foreground">0</span>
                                        )}
                                    </td>

                                    {/* ACV */}
                                    <td className="px-4 py-3 text-right font-mono text-xs">
                                        {formatCurrency(account.acv)}
                                    </td>

                                    {/* Close Date */}
                                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                        {formatDate(account.closeDate)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
