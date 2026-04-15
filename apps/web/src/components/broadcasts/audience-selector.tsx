'use client';

import { cn } from '@/lib/utils';
import { MOCK_ACCOUNTS } from '@/lib/mock-tickets';

export type AudienceType = 'all' | 'specific';

interface AudienceSelectorProps {
    audienceType: AudienceType;
    selectedAccountIds: string[];
    onAudienceTypeChange: (type: AudienceType) => void;
    onAccountsChange: (ids: string[]) => void;
}

export function AudienceSelector({
    audienceType,
    selectedAccountIds,
    onAudienceTypeChange,
    onAccountsChange,
}: AudienceSelectorProps) {
    const toggleAccount = (id: string) => {
        if (selectedAccountIds.includes(id)) {
            onAccountsChange(selectedAccountIds.filter((a) => a !== id));
        } else {
            onAccountsChange([...selectedAccountIds, id]);
        }
    };

    return (
        <div data-testid="audience-selector">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Audience
            </label>
            <div className="flex gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                        type="radio"
                        name="audience"
                        value="all"
                        checked={audienceType === 'all'}
                        onChange={() => onAudienceTypeChange('all')}
                        data-testid="audience-all"
                        className="accent-primary"
                    />
                    All accounts
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                        type="radio"
                        name="audience"
                        value="specific"
                        checked={audienceType === 'specific'}
                        onChange={() => onAudienceTypeChange('specific')}
                        data-testid="audience-specific"
                        className="accent-primary"
                    />
                    Specific accounts
                </label>
            </div>

            {audienceType === 'specific' && (
                <div className="mt-3 space-y-1" data-testid="account-list">
                    {MOCK_ACCOUNTS.map((account) => (
                        <label
                            key={account.id}
                            className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                                selectedAccountIds.includes(account.id)
                                    ? 'border-primary bg-primary/5 text-foreground'
                                    : 'border-border text-muted-foreground hover:border-primary/50',
                            )}
                        >
                            <input
                                type="checkbox"
                                checked={selectedAccountIds.includes(account.id)}
                                onChange={() => toggleAccount(account.id)}
                                data-testid={`account-${account.id}`}
                                className="accent-primary"
                            />
                            {account.name}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}
