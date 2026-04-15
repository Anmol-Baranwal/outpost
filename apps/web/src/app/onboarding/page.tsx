'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

interface OnboardingMember {
    id: string;
    discordId: string;
    username: string;
    joinedAt: string;
    funnelStage: string;
    contacted: boolean;
    responded: boolean;
    meetingBooked: boolean;
}

interface FunnelMetrics {
    stageCounts: Record<string, number>;
    conversionRates: {
        joinedToContacted: number;
        contactedToResponded: number;
        respondedToMeetingBooked: number;
    };
    totalMembers: number;
}

const STAGE_LABELS: Record<string, string> = {
    JOINED: 'Joined',
    CONTACTED: 'Contacted',
    RESPONDED: 'Responded',
    MEETING_BOOKED: 'Meeting Booked',
};

const STAGE_COLORS: Record<string, string> = {
    JOINED: 'bg-blue-500',
    CONTACTED: 'bg-amber-500',
    RESPONDED: 'bg-emerald-500',
    MEETING_BOOKED: 'bg-purple-500',
};

const NEXT_STAGE: Record<string, string> = {
    JOINED: 'CONTACTED',
    CONTACTED: 'RESPONDED',
    RESPONDED: 'MEETING_BOOKED',
};

const ACTION_LABELS: Record<string, string> = {
    JOINED: 'Mark Contacted',
    CONTACTED: 'Mark Responded',
    RESPONDED: 'Book Meeting',
};

export default function OnboardingPage() {
    const [members, setMembers] = useState<OnboardingMember[]>([]);
    const [metrics, setMetrics] = useState<FunnelMetrics | null>(null);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set('from', dateFrom);
            if (dateTo) params.set('to', dateTo);
            const qs = params.toString() ? `?${params.toString()}` : '';

            const [membersRes, metricsRes] = await Promise.all([
                fetch(`/api/onboarding/members${qs}`),
                fetch(`/api/onboarding/metrics${qs}`),
            ]);

            const membersData = await membersRes.json();
            const metricsData = await metricsRes.json();

            setMembers(membersData.members);
            setMetrics(metricsData);
        } catch (error) {
            console.error('Failed to fetch onboarding data:', error);
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    async function advanceStage(memberId: string, nextStage: string) {
        try {
            await fetch(`/api/onboarding/members/${memberId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ funnelStage: nextStage }),
            });
            await fetchData();
        } catch (error) {
            console.error('Failed to update member stage:', error);
        }
    }

    const maxCount = metrics
        ? Math.max(...Object.values(metrics.stageCounts), 1)
        : 1;

    return (
        <div>
            <PageHeader
                title="Onboarding"
                description="Track new community members through the greeting funnel."
                icon={Users}
                breadcrumbs={[{ label: 'Onboarding' }]}
            />

            {/* Date range filter */}
            <div className="mb-6 flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <label htmlFor="date-from" className="text-sm text-muted-foreground">From</label>
                    <input
                        id="date-from"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="date-to" className="text-sm text-muted-foreground">To</label>
                    <input
                        id="date-to"
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
                    />
                </div>
                {(dateFrom || dateTo) && (
                    <button
                        onClick={() => { setDateFrom(''); setDateTo(''); }}
                        className="text-sm text-muted-foreground hover:text-foreground"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Funnel visualization */}
            {metrics && (
                <div className="mb-8 rounded-lg border border-border bg-card p-6">
                    <h2 className="mb-4 text-lg font-semibold text-foreground">Conversion Funnel</h2>
                    <div className="space-y-3">
                        {['JOINED', 'CONTACTED', 'RESPONDED', 'MEETING_BOOKED'].map((stage, idx) => {
                            const count = metrics.stageCounts[stage] ?? 0;
                            const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
                            const rates = [
                                null,
                                metrics.conversionRates.joinedToContacted,
                                metrics.conversionRates.contactedToResponded,
                                metrics.conversionRates.respondedToMeetingBooked,
                            ];
                            return (
                                <div key={stage}>
                                    <div className="mb-1 flex items-center justify-between text-sm">
                                        <span className="font-medium text-foreground">
                                            {STAGE_LABELS[stage]}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {count} members
                                            {rates[idx] !== null && rates[idx] !== undefined && (
                                                <span className="ml-2 text-xs">
                                                    ({rates[idx]}% conversion)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="h-8 w-full rounded-md bg-muted">
                                        <div
                                            className={`h-full rounded-md ${STAGE_COLORS[stage]} transition-all duration-300`}
                                            style={{ width: `${Math.max(width, 2)}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-4 text-sm text-muted-foreground">
                        Total members: {metrics.totalMembers}
                    </div>
                </div>
            )}

            {/* Members table */}
            <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-6 py-3">
                    <div className="grid grid-cols-5 text-sm font-medium text-muted-foreground">
                        <span>Username</span>
                        <span>Join Date</span>
                        <span>Stage</span>
                        <span>Status</span>
                        <span>Action</span>
                    </div>
                </div>
                {loading ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                        Loading...
                    </div>
                ) : members.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                        No members found for the selected date range.
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {members.map((member) => (
                            <div key={member.id} className="grid grid-cols-5 items-center px-6 py-3 text-sm">
                                <span className="font-medium text-foreground">{member.username}</span>
                                <span className="text-muted-foreground">
                                    {new Date(member.joinedAt).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </span>
                                <span>
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white ${STAGE_COLORS[member.funnelStage]}`}>
                                        {STAGE_LABELS[member.funnelStage]}
                                    </span>
                                </span>
                                <span className="text-muted-foreground">
                                    {member.meetingBooked ? 'Meeting booked' :
                                        member.responded ? 'Responded' :
                                            member.contacted ? 'Contacted' : 'New'}
                                </span>
                                <span>
                                    {NEXT_STAGE[member.funnelStage] && (
                                        <button
                                            onClick={() => advanceStage(member.id, NEXT_STAGE[member.funnelStage])}
                                            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                                        >
                                            {ACTION_LABELS[member.funnelStage]}
                                        </button>
                                    )}
                                    {member.funnelStage === 'MEETING_BOOKED' && (
                                        <span className="text-xs text-emerald-500 font-medium">Complete</span>
                                    )}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
