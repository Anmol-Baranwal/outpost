import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
            <TicketsTrend data={SAMPLE_DATA} month="April" totalTickets={19} />,
        );
        expect(screen.getByText('April')).toBeInTheDocument();
    });

    it('renders the total ticket count', () => {
        render(
            <TicketsTrend data={SAMPLE_DATA} month="April" totalTickets={42} />,
        );
        expect(screen.getByTestId('trend-total')).toHaveTextContent('42');
    });

    it('renders the chart container', () => {
        render(
            <TicketsTrend data={SAMPLE_DATA} month="April" totalTickets={10} />,
        );
        expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    });

    it('renders the heading', () => {
        render(
            <TicketsTrend data={SAMPLE_DATA} month="March" totalTickets={0} />,
        );
        expect(screen.getByText('Tickets Trend')).toBeInTheDocument();
    });

    it('renders chart components', () => {
        render(
            <TicketsTrend data={SAMPLE_DATA} month="April" totalTickets={5} />,
        );
        expect(screen.getByTestId('area-chart')).toBeInTheDocument();
        expect(screen.getByTestId('area')).toBeInTheDocument();
    });
});
