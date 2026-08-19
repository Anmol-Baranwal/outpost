import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardPage from '@/app/dashboard/page';

// Mock recharts to avoid canvas/SVG issues in jsdom
vi.mock('recharts', () => {
    const Passthrough = ({ children }: { children?: React.ReactNode }) => (
        <div>{children}</div>
    );
    const Leaf = () => <div />;
    return {
        ResponsiveContainer: Passthrough,
        AreaChart: Passthrough,
        Area: Leaf,
        XAxis: Leaf,
        YAxis: Leaf,
        CartesianGrid: Leaf,
        Tooltip: Leaf,
    };
});

// The panels beside the chart fetch on their own; they are not under test here.
vi.mock('@/components/dashboard/my-tasks', () => ({
    MyTasks: () => <div data-testid="my-tasks" />,
}));
vi.mock('@/components/dashboard/faq-section', () => ({
    FaqSection: () => <div data-testid="faq-section" />,
}));

interface Deferred {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
}

function deferred(): Deferred {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function statsBody(monthKey: string, month: string, totalTickets: number) {
    return {
        slaBreaches: 0,
        avgFirstResponseMs: 60000,
        avgResolutionMs: 0,
        totalTickets,
        openTickets: totalTickets,
        trend: [{ day: 1, count: totalTickets }],
        month,
        monthKey,
        availableMonths: ['2026-05', '2026-06', '2026-07'],
        year: 2026,
    };
}

describe('DashboardPage month selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('ignores a slow earlier response that lands after a newer selection', async () => {
        // June is requested first and resolves LAST — the race the guard exists
        // for. Without it, June's 47 would overwrite May's 4 and the chart would
        // show a month the operator already navigated away from.
        const initial = statsBody('2026-07', 'July 2026', 12);
        const june = deferred();
        const may = deferred();

        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url.includes('month=2026-06')) {
                    return Promise.resolve({ ok: true, json: () => june.promise });
                }
                if (url.includes('month=2026-05')) {
                    return Promise.resolve({ ok: true, json: () => may.promise });
                }
                return Promise.resolve({ ok: true, json: async () => initial });
            }),
        );

        render(<DashboardPage />);
        await waitFor(() => expect(screen.getByTestId('trend-total')).toHaveTextContent('12'));

        const select = screen.getByLabelText('Select month');
        fireEvent.change(select, { target: { value: '2026-06' } });
        fireEvent.change(select, { target: { value: '2026-05' } });

        may.resolve(statsBody('2026-05', 'May 2026', 4));
        await waitFor(() => expect(screen.getByTestId('trend-total')).toHaveTextContent('4'));

        // June arrives late. It must be discarded.
        june.resolve(statsBody('2026-06', 'June 2026', 47));
        await Promise.resolve();

        await waitFor(() => {
            expect(screen.getByTestId('trend-total')).toHaveTextContent('4');
        });
        expect(screen.getByTestId('trend-total')).not.toHaveTextContent('47');
        expect((screen.getByLabelText('Select month') as HTMLSelectElement).value).toBe('2026-05');
    });

    it('shows the operator selection in the dropdown before the response arrives', async () => {
        const initial = statsBody('2026-07', 'July 2026', 12);
        const pending = deferred();

        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url.includes('month=2026-06')) {
                    return Promise.resolve({ ok: true, json: () => pending.promise });
                }
                return Promise.resolve({ ok: true, json: async () => initial });
            }),
        );

        render(<DashboardPage />);
        await waitFor(() => expect(screen.getByTestId('trend-total')).toHaveTextContent('12'));

        fireEvent.change(screen.getByLabelText('Select month'), {
            target: { value: '2026-06' },
        });

        // Response has not landed yet; the selector must still read June.
        expect((screen.getByLabelText('Select month') as HTMLSelectElement).value).toBe('2026-06');

        pending.resolve(statsBody('2026-06', 'June 2026', 47));
        await waitFor(() => expect(screen.getByTestId('trend-total')).toHaveTextContent('47'));
    });

    it('requests the selected month from the API', async () => {
        const initial = statsBody('2026-07', 'July 2026', 12);
        const fetchMock = vi.fn(() =>
            Promise.resolve({ ok: true, json: async () => initial }),
        );
        vi.stubGlobal('fetch', fetchMock);

        render(<DashboardPage />);
        await waitFor(() => expect(screen.getByTestId('trend-total')).toHaveTextContent('12'));

        fireEvent.change(screen.getByLabelText('Select month'), {
            target: { value: '2026-05' },
        });

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/stats?month=2026-05'),
        );
    });
});
