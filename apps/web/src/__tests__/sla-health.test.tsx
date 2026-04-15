import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlaHealth, formatDuration } from '@/components/dashboard/sla-health';

describe('formatDuration', () => {
    it('returns "0 sec" for zero ms', () => {
        expect(formatDuration(0)).toBe('0 sec');
    });

    it('formats seconds only', () => {
        expect(formatDuration(45000)).toBe('45 sec');
    });

    it('formats minutes and seconds', () => {
        expect(formatDuration(230000)).toBe('3 min 50 sec');
    });

    it('formats hours and minutes', () => {
        // 2 hours 15 minutes = 8100000ms
        expect(formatDuration(8100000)).toBe('2 hrs 15 min');
    });

    it('formats days and hours', () => {
        expect(formatDuration(90000000)).toBe('1 day 1 hr');
    });

    it('handles exact hour boundaries', () => {
        expect(formatDuration(3600000)).toBe('1 hr');
    });

    it('handles exact day boundaries', () => {
        expect(formatDuration(86400000)).toBe('1 day');
    });

    it('returns "0 sec" for negative values', () => {
        expect(formatDuration(-1000)).toBe('0 sec');
    });
});

describe('SlaHealth', () => {
    it('renders placeholder values when no metrics provided', () => {
        render(<SlaHealth />);
        const dashes = screen.getAllByText('—');
        expect(dashes).toHaveLength(3);
    });

    it('renders breach count', () => {
        render(
            <SlaHealth
                metrics={{
                    slaBreaches: 5,
                    avgFirstResponseMs: 230000,
                    avgResolutionMs: 97140000,
                }}
            />,
        );
        expect(screen.getByTestId('sla-sla-breaches')).toHaveTextContent('5');
    });

    it('renders formatted response time', () => {
        render(
            <SlaHealth
                metrics={{
                    slaBreaches: 0,
                    avgFirstResponseMs: 230000,
                    avgResolutionMs: 97140000,
                }}
            />,
        );
        expect(screen.getByTestId('sla-avg-first-response')).toHaveTextContent('3 min 50 sec');
    });

    it('renders formatted resolution time', () => {
        render(
            <SlaHealth
                metrics={{
                    slaBreaches: 0,
                    avgFirstResponseMs: 60000,
                    avgResolutionMs: 97140000,
                }}
            />,
        );
        expect(screen.getByTestId('sla-avg-resolution-time')).toHaveTextContent('1 day 2 hrs');
    });

    it('shows all three metric labels', () => {
        render(
            <SlaHealth
                metrics={{
                    slaBreaches: 0,
                    avgFirstResponseMs: 0,
                    avgResolutionMs: 0,
                }}
            />,
        );
        expect(screen.getByText('SLA Breaches')).toBeInTheDocument();
        expect(screen.getByText('Avg First Response')).toBeInTheDocument();
        expect(screen.getByText('Avg Resolution Time')).toBeInTheDocument();
    });
});
