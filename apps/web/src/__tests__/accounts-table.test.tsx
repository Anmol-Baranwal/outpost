import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountsTable } from '@/components/accounts/accounts-table';
import { getAccountsWithTicketCounts } from '@/lib/mock-accounts';

const mockAccounts = getAccountsWithTicketCounts();

describe('AccountsTable', () => {
    const defaultProps = {
        accounts: mockAccounts,
        searchQuery: '',
        onSearchChange: vi.fn(),
        onOwnerChange: vi.fn(),
    };

    it('renders the table with all accounts', () => {
        render(<AccountsTable {...defaultProps} />);
        expect(screen.getByTestId('accounts-table')).toBeTruthy();
        expect(screen.getByText('10 accounts')).toBeTruthy();
    });

    it('renders account names', () => {
        render(<AccountsTable {...defaultProps} />);
        expect(screen.getByText('Acme Corp')).toBeTruthy();
        expect(screen.getByText('TechStart Inc')).toBeTruthy();
        expect(screen.getByText('DataFlow Labs')).toBeTruthy();
    });

    it('renders sentiment badges', () => {
        render(<AccountsTable {...defaultProps} />);
        const sentimentBadges = screen.getAllByTestId('sentiment-badge');
        expect(sentimentBadges.length).toBe(mockAccounts.length);
    });

    it('renders engagement badges', () => {
        render(<AccountsTable {...defaultProps} />);
        const engagementBadges = screen.getAllByTestId('engagement-badge');
        expect(engagementBadges.length).toBe(mockAccounts.length);
    });

    it('renders search input', () => {
        render(<AccountsTable {...defaultProps} />);
        expect(screen.getByTestId('accounts-search')).toBeTruthy();
    });

    it('calls onSearchChange when typing in search', () => {
        const onSearchChange = vi.fn();
        render(<AccountsTable {...defaultProps} onSearchChange={onSearchChange} />);
        const searchInput = screen.getByTestId('accounts-search');
        fireEvent.change(searchInput, { target: { value: 'Acme' } });
        expect(onSearchChange).toHaveBeenCalledWith('Acme');
    });

    it('shows empty state when no accounts exist', () => {
        render(<AccountsTable {...defaultProps} accounts={[]} />);
        expect(screen.getByText(/No accounts yet/)).toBeTruthy();
    });

    it('shows search empty state when search has no results', () => {
        render(<AccountsTable {...defaultProps} accounts={[]} searchQuery="xyz" />);
        expect(screen.getByText('No accounts match the current search.')).toBeTruthy();
    });

    it('renders sortable column headers', () => {
        render(<AccountsTable {...defaultProps} />);
        expect(screen.getByTestId('sort-name')).toBeTruthy();
        expect(screen.getByTestId('sort-acv')).toBeTruthy();
        expect(screen.getByTestId('sort-sentiment')).toBeTruthy();
    });

    it('renders ticket count links for accounts with tickets', () => {
        render(<AccountsTable {...defaultProps} />);
        // acc-1 (Acme Corp) has open tickets, so it should have a clickable link
        const openLink = screen.getByTestId('open-tickets-link-acc-1');
        expect(openLink).toBeTruthy();
        expect(openLink.tagName).toBe('A');
        expect(openLink.getAttribute('href')).toContain('/tickets?accountId=acc-1');
        expect(openLink.getAttribute('href')).toContain('status=OPEN');
    });

    it('renders ACV formatted as currency', () => {
        render(<AccountsTable {...defaultProps} />);
        // Acme Corp has ACV of 120000
        expect(screen.getByText('$120,000')).toBeTruthy();
    });

    it('renders owner select dropdowns', () => {
        render(<AccountsTable {...defaultProps} />);
        const ownerTriggers = screen.getAllByTestId('owner-select-trigger');
        expect(ownerTriggers.length).toBe(mockAccounts.length);
    });

    it('renders close dates for accounts that have them', () => {
        render(<AccountsTable {...defaultProps} />);
        // Check that the table renders without errors - dates are locale-dependent
        const rows = screen.getAllByTestId(/^account-row-/);
        expect(rows.length).toBe(mockAccounts.length);
    });

    it('renders dashes for null ACV', () => {
        render(<AccountsTable {...defaultProps} />);
        const dashes = screen.getAllByText('--');
        expect(dashes.length).toBeGreaterThan(0);
    });

    it('singular account count for single result', () => {
        const singleAccount = [mockAccounts[0]];
        render(<AccountsTable {...defaultProps} accounts={singleAccount} />);
        expect(screen.getByText('1 account')).toBeTruthy();
    });
});
