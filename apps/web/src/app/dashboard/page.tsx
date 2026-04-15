import { LayoutDashboard } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export default function DashboardPage() {
    return (
        <div>
            <PageHeader
                title="Dashboard"
                description="Overview of support operations and key metrics."
                icon={LayoutDashboard}
                breadcrumbs={[{ label: 'Dashboard' }]}
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Open Tickets" value="12" trend="+3 today" />
                <StatCard title="Avg Response Time" value="23m" trend="-5m vs last week" />
                <StatCard title="Resolution Rate" value="87%" trend="+2% vs last week" />
                <StatCard title="Customer Satisfaction" value="4.6/5" trend="Stable" />
            </div>
            <div className="mt-8 rounded-lg border border-border bg-card p-6">
                <h2 className="text-lg font-semibold text-card-foreground">Recent Activity</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    Activity feed will be populated once the backend is connected.
                </p>
            </div>
        </div>
    );
}

function StatCard({ title, value, trend }: { title: string; value: string; trend: string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-6">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-2 text-3xl font-bold text-card-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{trend}</p>
        </div>
    );
}
