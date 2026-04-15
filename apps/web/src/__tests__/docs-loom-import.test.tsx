import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoomImport } from '@/components/docs/loom-import';

describe('LoomImport', () => {
    it('renders the import form', () => {
        render(<LoomImport />);

        expect(screen.getByText('Import from Loom')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('https://www.loom.com/share/...')).toBeInTheDocument();
        expect(screen.getByText('Generate Article')).toBeInTheDocument();
    });

    it('shows error for empty URL', () => {
        render(<LoomImport />);

        fireEvent.click(screen.getByText('Generate Article'));

        expect(screen.getByText('Please enter a Loom URL')).toBeInTheDocument();
    });

    it('shows error for invalid URL', () => {
        render(<LoomImport />);

        const input = screen.getByPlaceholderText('https://www.loom.com/share/...');
        fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=123' } });
        fireEvent.click(screen.getByText('Generate Article'));

        expect(screen.getByText('Please enter a valid Loom URL (e.g., https://www.loom.com/share/...)')).toBeInTheDocument();
    });

    it('shows error for malformed URL', () => {
        render(<LoomImport />);

        const input = screen.getByPlaceholderText('https://www.loom.com/share/...');
        fireEvent.change(input, { target: { value: 'not-a-url' } });
        fireEvent.click(screen.getByText('Generate Article'));

        expect(screen.getByText('Please enter a valid Loom URL (e.g., https://www.loom.com/share/...)')).toBeInTheDocument();
    });

    it('accepts valid Loom URLs', () => {
        render(<LoomImport />);

        const input = screen.getByPlaceholderText('https://www.loom.com/share/...');
        fireEvent.change(input, { target: { value: 'https://www.loom.com/share/abc123def456' } });
        fireEvent.click(screen.getByText('Generate Article'));

        // Should not show the invalid URL error
        expect(screen.queryByText('Please enter a valid Loom URL (e.g., https://www.loom.com/share/...)')).not.toBeInTheDocument();
        expect(screen.queryByText('Please enter a Loom URL')).not.toBeInTheDocument();
    });

    it('accepts loom.com without www', () => {
        render(<LoomImport />);

        const input = screen.getByPlaceholderText('https://www.loom.com/share/...');
        fireEvent.change(input, { target: { value: 'https://loom.com/share/abc123' } });
        fireEvent.click(screen.getByText('Generate Article'));

        expect(screen.queryByText('Please enter a valid Loom URL (e.g., https://www.loom.com/share/...)')).not.toBeInTheDocument();
    });
});
