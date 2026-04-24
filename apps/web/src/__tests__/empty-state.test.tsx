import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '@/components/empty-state';

describe('EmptyState', () => {
    it('renders title and description', () => {
        render(
            <EmptyState
                title="No tickets yet"
                description="Tickets will appear here when customers reach out."
            />,
        );

        expect(screen.getByText('No tickets yet')).toBeInTheDocument();
        expect(screen.getByText('Tickets will appear here when customers reach out.')).toBeInTheDocument();
    });

    it('renders icon when provided', () => {
        render(
            <EmptyState
                icon={<span data-testid="test-icon">icon</span>}
                title="Empty"
                description="Nothing here"
            />,
        );

        expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('does not render icon container when icon is not provided', () => {
        const { container } = render(
            <EmptyState title="Empty" description="Nothing here" />,
        );

        // The icon container should not exist
        expect(container.querySelector('.rounded-full')).not.toBeInTheDocument();
    });

    it('renders action button when action is provided', () => {
        const onClick = vi.fn();
        render(
            <EmptyState
                title="Empty"
                description="Nothing here"
                action={{ label: 'Create one', onClick }}
            />,
        );

        const button = screen.getByTestId('empty-state-action');
        expect(button).toHaveTextContent('Create one');

        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('does not render action button when action is not provided', () => {
        render(
            <EmptyState title="Empty" description="Nothing here" />,
        );

        expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
        render(
            <EmptyState
                title="Empty"
                description="Nothing here"
                className="custom-class"
            />,
        );

        expect(screen.getByTestId('empty-state')).toHaveClass('custom-class');
    });
});
