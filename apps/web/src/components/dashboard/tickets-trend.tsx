'use client';

import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

export interface TrendDataPoint {
    day: number;
    count: number;
}

interface TicketsTrendProps {
    data: TrendDataPoint[];
    month: string;
    totalTickets: number;
}

export function TicketsTrend({ data, month, totalTickets }: TicketsTrendProps) {
    return (
        <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-card-foreground">
                        Tickets Trend
                    </h3>
                    <p className="text-sm text-muted-foreground">{month}</p>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-bold text-card-foreground" data-testid="trend-total">
                        {totalTickets}
                    </p>
                    <p className="text-xs text-muted-foreground">total tickets</p>
                </div>
            </div>

            <div className="h-[200px] w-full" data-testid="trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
                        margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="ticketGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                            vertical={false}
                        />
                        <XAxis
                            dataKey="day"
                            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                fontSize: '12px',
                            }}
                            labelFormatter={(day) => `Day ${day}`}
                            formatter={(value) => [String(value), 'Tickets']}
                        />
                        <Area
                            type="monotone"
                            dataKey="count"
                            stroke="hsl(var(--primary))"
                            fill="url(#ticketGradient)"
                            strokeWidth={2}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
