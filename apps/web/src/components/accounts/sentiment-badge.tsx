'use client';

import { AccountSentiment } from '@copilotkit/outpost-shared';
import { cn } from '@/lib/utils';

interface SentimentBadgeProps {
    sentiment: AccountSentiment;
    className?: string;
}

const SENTIMENT_CONFIG: Record<AccountSentiment, { label: string; color: string }> = {
    [AccountSentiment.HAPPY]: {
        label: 'Happy',
        color: 'bg-green-100 text-green-700',
    },
    [AccountSentiment.NEUTRAL]: {
        label: 'Neutral',
        color: 'bg-slate-100 text-slate-600',
    },
    [AccountSentiment.AT_RISK]: {
        label: 'At Risk',
        color: 'bg-orange-100 text-orange-700',
    },
    [AccountSentiment.CHURNING]: {
        label: 'Churning',
        color: 'bg-red-100 text-red-700',
    },
};

export function SentimentBadge({ sentiment, className }: SentimentBadgeProps) {
    const config = SENTIMENT_CONFIG[sentiment];
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                config.color,
                className,
            )}
            data-testid="sentiment-badge"
        >
            {config.label}
        </span>
    );
}
