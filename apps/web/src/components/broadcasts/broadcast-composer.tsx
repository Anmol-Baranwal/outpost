'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AudienceSelector } from './audience-selector';
import { SenderPicker } from './sender-picker';
import type { AudienceType, AccountOption } from './audience-selector';
import type { TeamMemberOption } from './sender-picker';

const MAX_BROADCAST_LENGTH = 500;

export interface BroadcastFormData {
    message: string;
    audienceType: AudienceType;
    audienceAccountIds: string[];
    senderId: string;
}

interface BroadcastComposerProps {
    onSend: (data: BroadcastFormData) => void;
    onSaveDraft: (data: BroadcastFormData) => void;
    onCancel: () => void;
    initialData?: Partial<BroadcastFormData>;
    accounts: AccountOption[];
    teamMembers: TeamMemberOption[];
}

export function BroadcastComposer({
    onSend,
    onSaveDraft,
    onCancel,
    initialData,
    accounts,
    teamMembers,
}: BroadcastComposerProps) {
    const [message, setMessage] = useState(initialData?.message ?? '');
    const [audienceType, setAudienceType] = useState<AudienceType>(
        initialData?.audienceType ?? 'all',
    );
    const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
        initialData?.audienceAccountIds ?? [],
    );
    const [senderId, setSenderId] = useState(initialData?.senderId ?? teamMembers[0]?.id ?? '');

    const charCount = message.length;
    const isOverLimit = charCount > MAX_BROADCAST_LENGTH;
    const isEmpty = message.trim().length === 0;
    const needsAccounts = audienceType === 'specific' && selectedAccountIds.length === 0;
    const canSend = !isEmpty && !isOverLimit && !needsAccounts;

    const formData: BroadcastFormData = {
        message,
        audienceType,
        audienceAccountIds: audienceType === 'all' ? [] : selectedAccountIds,
        senderId,
    };

    return (
        <div className="space-y-5" data-testid="broadcast-composer">
            {/* Message textarea */}
            <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Message
                </label>
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Write your broadcast message..."
                    rows={5}
                    data-testid="broadcast-message"
                    className={cn(
                        'w-full resize-none rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1',
                        isOverLimit
                            ? 'border-destructive focus:ring-destructive'
                            : 'border-border focus:ring-primary',
                    )}
                />
                <div className="mt-1 flex items-center justify-between">
                    <span
                        data-testid="char-count"
                        className={cn(
                            'text-xs',
                            isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground',
                        )}
                    >
                        {charCount}/{MAX_BROADCAST_LENGTH}
                    </span>
                    {isOverLimit && (
                        <span className="text-xs text-destructive" data-testid="char-limit-error">
                            Message exceeds character limit
                        </span>
                    )}
                </div>
            </div>

            {/* Audience */}
            <AudienceSelector
                audienceType={audienceType}
                selectedAccountIds={selectedAccountIds}
                onAudienceTypeChange={setAudienceType}
                onAccountsChange={setSelectedAccountIds}
                accounts={accounts}
            />

            {/* Sender */}
            <SenderPicker selectedSenderId={senderId} onSenderChange={setSenderId} teamMembers={teamMembers} />

            {/* Actions */}
            <div className="flex items-center gap-3 border-t border-border pt-4">
                <button
                    onClick={() => canSend && onSend(formData)}
                    disabled={!canSend}
                    data-testid="send-button"
                    className={cn(
                        'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                        canSend
                            ? 'bg-primary text-primary-foreground hover:opacity-90'
                            : 'cursor-not-allowed bg-muted text-muted-foreground',
                    )}
                >
                    Send Broadcast
                </button>
                <button
                    onClick={() => !isEmpty && !isOverLimit && onSaveDraft(formData)}
                    disabled={isEmpty || isOverLimit}
                    data-testid="save-draft-button"
                    className={cn(
                        'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                        !isEmpty && !isOverLimit
                            ? 'border-border text-foreground hover:bg-muted'
                            : 'cursor-not-allowed border-border text-muted-foreground',
                    )}
                >
                    Save as Draft
                </button>
                <button
                    onClick={onCancel}
                    data-testid="cancel-button"
                    className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
