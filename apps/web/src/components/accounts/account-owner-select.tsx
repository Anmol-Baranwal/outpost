'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCOUNT_OWNERS } from '@/lib/mock-accounts';

interface AccountOwnerSelectProps {
    value: string | null;
    onChange: (owner: string | null) => void;
    className?: string;
}

export function AccountOwnerSelect({ value, onChange, className }: AccountOwnerSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs',
                    'hover:bg-accent transition-colors',
                    !value && 'text-muted-foreground',
                )}
                data-testid="owner-select-trigger"
            >
                <span className="truncate max-w-[120px]">
                    {value || 'Unassigned'}
                </span>
                <ChevronDown className="h-3 w-3 flex-shrink-0" />
            </button>
            {isOpen && (
                <div
                    className="absolute top-full left-0 z-50 mt-1 w-48 rounded-md border border-border bg-popover shadow-md"
                    data-testid="owner-select-menu"
                >
                    <button
                        type="button"
                        onClick={() => {
                            onChange(null);
                            setIsOpen(false);
                        }}
                        className={cn(
                            'w-full px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors',
                            value === null && 'bg-accent font-medium',
                        )}
                    >
                        Unassigned
                    </button>
                    {ACCOUNT_OWNERS.map(owner => (
                        <button
                            key={owner}
                            type="button"
                            onClick={() => {
                                onChange(owner);
                                setIsOpen(false);
                            }}
                            className={cn(
                                'w-full px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors',
                                value === owner && 'bg-accent font-medium',
                            )}
                        >
                            {owner}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
