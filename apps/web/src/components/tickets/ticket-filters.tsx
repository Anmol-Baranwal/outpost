'use client';

import { useState, useCallback } from 'react';
import {
    TicketStatus,
    TicketPriority,
    TicketType,
    TicketSource,
} from '@copilotkit/outpost/shared';
import { cn } from '@/lib/utils';
import type { Account, TeamMember } from './types';

export interface TicketFilters {
    search: string;
    status: string[];
    source: string[];
    priority: string[];
    type: string[];
    accountId: string;
    assigneeId: string;
}

export const DEFAULT_FILTERS: TicketFilters = {
    search: '',
    status: [],
    source: [],
    priority: [],
    type: [],
    accountId: '',
    assigneeId: '',
};

interface TicketFilterPanelProps {
    filters: TicketFilters;
    onFiltersChange: (filters: TicketFilters) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
    accounts: Account[];
    teamMembers: TeamMember[];
    className?: string;
}

const statusLabels: Record<string, string> = {
    [TicketStatus.OPEN]: 'Open',
    [TicketStatus.IN_PROGRESS]: 'In Progress',
    [TicketStatus.WAITING_ON_CUSTOMER]: 'Waiting (Customer)',
    [TicketStatus.WAITING_ON_TEAM]: 'Waiting (Team)',
    [TicketStatus.RESOLVED]: 'Resolved',
    [TicketStatus.CLOSED]: 'Closed',
};

const sourceLabels: Record<string, string> = {
    [TicketSource.DISCORD]: 'Discord',
    [TicketSource.SLACK]: 'Slack',
    [TicketSource.TEAMS]: 'Teams',
    [TicketSource.ORCA]: 'Orca',
    [TicketSource.GITHUB_ISSUE]: 'GitHub Issues',
    [TicketSource.GITHUB_DISCUSSION]: 'GitHub Discussions',
    [TicketSource.WEB]: 'Web',
    [TicketSource.EMAIL]: 'Email',
    [TicketSource.MANUAL]: 'Manual',
};

const priorityLabels: Record<string, string> = {
    [TicketPriority.CRITICAL]: 'Critical',
    [TicketPriority.HIGH]: 'High',
    [TicketPriority.MEDIUM]: 'Medium',
    [TicketPriority.LOW]: 'Low',
};

const typeLabels: Record<string, string> = {
    [TicketType.BUG]: 'Bug',
    [TicketType.FEATURE_REQUEST]: 'Feature Request',
    [TicketType.QUESTION]: 'Question',
    [TicketType.INTEGRATION_HELP]: 'Integration Help',
    [TicketType.ACCOUNT_ISSUE]: 'Account Issue',
    [TicketType.OTHER]: 'Other',
};

function MultiSelect({
    label,
    options,
    selected,
    onChange,
}: {
    label: string;
    options: Record<string, string>;
    selected: string[];
    onChange: (values: string[]) => void;
}) {
    const toggle = (value: string) => {
        if (selected.includes(value)) {
            onChange(selected.filter((v) => v !== value));
        } else {
            onChange([...selected, value]);
        }
    };

    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
                {label}
            </label>
            <div className="flex flex-wrap gap-1">
                {Object.entries(options).map(([value, displayLabel]) => (
                    <button
                        key={value}
                        onClick={() => toggle(value)}
                        className={cn(
                            'text-xs px-2 py-1 rounded border transition-colors',
                            selected.includes(value)
                                ? 'bg-primary/10 border-primary/40 text-primary'
                                : 'bg-card border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                    >
                        {displayLabel}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function TicketFilterPanel({
    filters,
    onFiltersChange,
    searchInputRef,
    accounts,
    teamMembers,
    className,
}: TicketFilterPanelProps) {
    const [expanded, setExpanded] = useState(false);

    const activeFilterCount =
        filters.status.length +
        filters.source.length +
        filters.priority.length +
        filters.type.length +
        (filters.accountId ? 1 : 0) +
        (filters.assigneeId ? 1 : 0);

    const updateFilter = useCallback(
        <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) => {
            onFiltersChange({ ...filters, [key]: value });
        },
        [filters, onFiltersChange],
    );

    const resetFilters = useCallback(() => {
        onFiltersChange(DEFAULT_FILTERS);
    }, [onFiltersChange]);

    const activeFilterSummary = () => {
        const parts: string[] = [];
        if (filters.status.length) parts.push(`Status: ${filters.status.map(s => statusLabels[s] || s).join(', ')}`);
        if (filters.priority.length) parts.push(`Priority: ${filters.priority.map(p => priorityLabels[p] || p).join(', ')}`);
        if (filters.source.length) parts.push(`Source: ${filters.source.map(s => sourceLabels[s] || s).join(', ')}`);
        if (filters.type.length) parts.push(`Type: ${filters.type.map(t => typeLabels[t] || t).join(', ')}`);
        return parts.join(' | ');
    };

    return (
        <div className={cn('border-b border-border', className)}>
            <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={filters.search}
                        onChange={(e) => updateFilter('search', e.target.value)}
                        placeholder="Search tickets... (press /)"
                        className="flex-1 text-sm bg-background border border-input rounded px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
                        data-testid="ticket-search-input"
                    />
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className={cn(
                            'text-xs px-2 py-1.5 rounded border transition-colors',
                            expanded || activeFilterCount > 0
                                ? 'bg-primary/10 border-primary/40 text-primary'
                                : 'bg-card border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                    >
                        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                    </button>
                </div>
                {activeFilterCount > 0 && !expanded && (
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">
                        {activeFilterSummary()}
                    </p>
                )}
            </div>
            {expanded && (
                <div className="px-3 pb-3 space-y-3">
                    <MultiSelect
                        label="Status"
                        options={statusLabels}
                        selected={filters.status}
                        onChange={(v) => updateFilter('status', v)}
                    />
                    <MultiSelect
                        label="Priority"
                        options={priorityLabels}
                        selected={filters.priority}
                        onChange={(v) => updateFilter('priority', v)}
                    />
                    <MultiSelect
                        label="Source"
                        options={sourceLabels}
                        selected={filters.source}
                        onChange={(v) => updateFilter('source', v)}
                    />
                    <MultiSelect
                        label="Type"
                        options={typeLabels}
                        selected={filters.type}
                        onChange={(v) => updateFilter('type', v)}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
                                Account
                            </label>
                            <select
                                value={filters.accountId}
                                onChange={(e) => updateFilter('accountId', e.target.value)}
                                className="w-full text-xs bg-background border border-input rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="">All accounts</option>
                                {accounts.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                        {acc.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
                                Assignee
                            </label>
                            <select
                                value={filters.assigneeId}
                                onChange={(e) => updateFilter('assigneeId', e.target.value)}
                                className="w-full text-xs bg-background border border-input rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="">All assignees</option>
                                {teamMembers.map((tm) => (
                                    <option key={tm.id} value={tm.id}>
                                        {tm.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={resetFilters}
                            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
