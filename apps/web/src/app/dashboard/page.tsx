'use client';

import { useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { MyTasks } from '@/components/dashboard/my-tasks';
import { SlaHealth } from '@/components/dashboard/sla-health';
import type { SlaMetrics } from '@/components/dashboard/sla-health';
import { TicketsTrend } from '@/components/dashboard/tickets-trend';
import type { TrendDataPoint } from '@/components/dashboard/tickets-trend';
import { FaqSection } from '@/components/dashboard/faq-section';

interface StatsResponse {
    slaBreaches: number;
    avgFirstResponseMs: number;
    avgResolutionMs: number;
    totalTickets: number;
    openTickets: number;
    trend: TrendDataPoint[];
    month: string;
    year: number;
}

export default function DashboardPage() {
    const [stats, setStats] = useState<StatsResponse | null>(null);

    useEffect(() => {
        async function fetchStats() {
            try {
                const res = await fetch('/api/dashboard/stats');
                const data: StatsResponse = await res.json();
                setStats(data);
            } catch {
                // Will show loading/empty states
            }
        }
        fetchStats();
    }, []);

    const slaMetrics: SlaMetrics | undefined = stats
        ? {
              slaBreaches: stats.slaBreaches,
              avgFirstResponseMs: stats.avgFirstResponseMs,
              avgResolutionMs: stats.avgResolutionMs,
          }
        : undefined;

    return (
        <div>
            <PageHeader
                title="Dashboard"
                description="Overview of support operations and key metrics."
                icon={LayoutDashboard}
                breadcrumbs={[{ label: 'Dashboard' }]}
            />

            <div className="space-y-6">
                {/* My Tasks - full width */}
                <MyTasks />

                {/* SLA Health cards */}
                <SlaHealth metrics={slaMetrics} />

                {/* Trend chart and FAQ side by side */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <TicketsTrend
                        data={stats?.trend ?? []}
                        month={stats?.month ?? ''}
                        totalTickets={stats?.totalTickets ?? 0}
                    />
                    <FaqSection />
                </div>
            </div>
        </div>
    );
}
