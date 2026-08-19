import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketsTrend } from '@/components/dashboard/tickets-trend';

// Mock recharts to avoid canvas/SVG issues in jsdom
vi.mock('recharts', () => {
    const MockResponsiveContainer = ({ children }: { children: React.ReactNode }) => (
        <div data-testid="responsive-container">{children}</div>
    );
    const MockAreaChart = ({ children }: { children: React.ReactNode }) => (
        <div data-testid="area-chart">{children}</div>
    );
    const MockArea = () => <div data-testid="area" />;
    const MockXAxis = () => <div data-testid="x-axis" />;
    const MockYAxis = () => <div data-testid="y-axis" />;
    const MockCartesianGrid = () => <div data-testid="cartesian-grid" />;
    const MockTooltip = () => <div data-testid="tooltip" />;

    return {
        ResponsiveContainer: MockResponsiveContainer,
        AreaChart: MockAreaChart,
        Area: MockArea,
        XAxis: MockXAxis,
        YAxis: MockYAxis,
        CartesianGrid: MockCartesianGrid,
        Tooltip: MockTooltip,
    };
});

const SAMPLE_DATA = [
    { day: 1, count: 3 },
    { day: 2, count: 5 },
    { day: 3, count: 2 },
    { day: 4, count: 8 },
    { day: 5, count: 1 },
];

describe('TicketsTrend', () => {
    it('renders the month label', () => {
        render(
            <TicketsTrend
                data={SAMPLE_DATA}
                month="April"
                monthKey="2026-04"
                availableMonths={['2026-04']}
                onMonthChange={vi.fn()}
                totalTickets={19}
            />,
        );
        expect(screen.getByText('April')).toBeInTheDocument();
    });

    it('renders the total ticket count', () => {
        render(
            <TicketsTrend
                data={SAMPLE_DATA}
                month="April"
                monthKey="2026-04"
                availableMonths={['2026-04']}
                onMonthChange={vi.fn()}
                totalTickets={42}
            />,
        );
        expect(screen.getByTestId('trend-total')).toHaveTextContent('42');
    });

    it('renders the chart container', () => {
        render(
            <TicketsTrend
                data={SAMPLE_DATA}
                month="April"
                monthKey="2026-04"
                availableMonths={['2026-04']}
                onMonthChange={vi.fn()}
                totalTickets={10}
            />,
        );
        expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    });

    it('renders the heading', () => {
        render(
            <TicketsTrend
                data={SAMPLE_DATA}
                month="March"
                monthKey="2026-03"
                availableMonths={['2026-03']}
                onMonthChange={vi.fn()}
                totalTickets={0}
            />,
        );
        expect(screen.getByText('Tickets Trend')).toBeInTheDocument();
    });

    it('renders chart components', () => {
        render(
            <TicketsTrend
                data={SAMPLE_DATA}
                month="April"
                monthKey="2026-04"
                availableMonths={['2026-04']}
                onMonthChange={vi.fn()}
                totalTickets={5}
            />,
        );
        expect(screen.getByTestId('area-chart')).toBeInTheDocument();
        expect(screen.getByTestId('area')).toBeInTheDocument();
    });

    const data = [
        { day: 1, count: 2 },
        { day: 2, count: 0 },
    ];

    it('renders one option per available month, labelled', () => {
        render(
            <TicketsTrend
                data={data}
                month="July 2026"
                monthKey="2026-07"
                availableMonths={['2026-06', '2026-07']}
                onMonthChange={vi.fn()}
                totalTickets={47}
            />,
        );

        const select = screen.getByLabelText('Select month') as HTMLSelectElement;
        expect(select.value).toBe('2026-07');
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
            'June 2026',
            'July 2026',
        ]);
    });

    it('reports the newly selected month key', () => {
        const onMonthChange = vi.fn();
        render(
            <TicketsTrend
                data={data}
                month="July 2026"
                monthKey="2026-07"
                availableMonths={['2026-06', '2026-07']}
                onMonthChange={onMonthChange}
                totalTickets={47}
            />,
        );

        fireEvent.change(screen.getByLabelText('Select month'), {
            target: { value: '2026-06' },
        });

        expect(onMonthChange).toHaveBeenCalledWith('2026-06');
    });

    it('shows the empty state for a month with no tickets', () => {
        render(
            <TicketsTrend
                data={[{ day: 1, count: 0 }]}
                month="June 2026"
                monthKey="2026-06"
                availableMonths={['2026-06', '2026-07']}
                onMonthChange={vi.fn()}
                totalTickets={0}
            />,
        );

        expect(screen.getByTestId('trend-empty')).toBeInTheDocument();
    });

    it('renders the selected month total', () => {
        render(
            <TicketsTrend
                data={data}
                month="July 2026"
                monthKey="2026-07"
                availableMonths={['2026-07']}
                onMonthChange={vi.fn()}
                totalTickets={47}
            />,
        );

        expect(screen.getByTestId('trend-total')).toHaveTextContent('47');
    });
});
