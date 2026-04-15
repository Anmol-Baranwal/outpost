'use client';

import { MOCK_TEAM_MEMBERS } from '@/lib/mock-tickets';
import { cn } from '@/lib/utils';

interface SenderPickerProps {
    selectedSenderId: string;
    onSenderChange: (senderId: string) => void;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

export function SenderPicker({ selectedSenderId, onSenderChange }: SenderPickerProps) {
    return (
        <div data-testid="sender-picker">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Send as
            </label>
            <div className="space-y-1">
                {MOCK_TEAM_MEMBERS.map((member) => (
                    <button
                        key={member.id}
                        type="button"
                        onClick={() => onSenderChange(member.id)}
                        data-testid={`sender-${member.id}`}
                        className={cn(
                            'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                            selectedSenderId === member.id
                                ? 'border-primary bg-primary/5 text-foreground'
                                : 'border-border text-muted-foreground hover:border-primary/50',
                        )}
                    >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                            {getInitials(member.name)}
                        </span>
                        <span className="flex flex-col items-start">
                            <span className="font-medium">{member.name}</span>
                            <span className="text-xs text-muted-foreground">{member.email}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
