import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BroadcastList } from '@/components/broadcasts/broadcast-list';
import { BroadcastComposer } from '@/components/broadcasts/broadcast-composer';
import { AudienceSelector } from '@/components/broadcasts/audience-selector';
import { SenderPicker } from '@/components/broadcasts/sender-picker';
import { MOCK_BROADCASTS, MAX_BROADCAST_LENGTH } from '@/lib/mock-broadcasts';

describe('BroadcastList', () => {
    const defaultProps = {
        broadcasts: MOCK_BROADCASTS,
        onStatusFilter: vi.fn(),
        activeFilter: null as 'draft' | 'sent' | null,
    };

    it('renders all filter tabs (All, Draft, Sent)', () => {
        render(<BroadcastList {...defaultProps} />);
        expect(screen.getByTestId('tab-all')).toBeDefined();
        expect(screen.getByTestId('tab-draft')).toBeDefined();
        expect(screen.getByTestId('tab-sent')).toBeDefined();
    });

    it('renders broadcast cards for each broadcast', () => {
        render(<BroadcastList {...defaultProps} />);
        for (const bc of MOCK_BROADCASTS) {
            expect(screen.getByTestId(`broadcast-card-${bc.id}`)).toBeDefined();
        }
    });

    it('displays correct status badges', () => {
        render(<BroadcastList {...defaultProps} />);
        const draftBroadcasts = MOCK_BROADCASTS.filter((b) => b.status === 'draft');
        const sentBroadcasts = MOCK_BROADCASTS.filter((b) => b.status === 'sent');

        for (const bc of draftBroadcasts) {
            expect(screen.getByTestId(`status-${bc.id}`).textContent).toBe('Draft');
        }
        for (const bc of sentBroadcasts) {
            expect(screen.getByTestId(`status-${bc.id}`).textContent).toBe('Sent');
        }
    });

    it('calls onStatusFilter when a tab is clicked', () => {
        const onStatusFilter = vi.fn();
        render(<BroadcastList {...defaultProps} onStatusFilter={onStatusFilter} />);

        fireEvent.click(screen.getByTestId('tab-draft'));
        expect(onStatusFilter).toHaveBeenCalledWith('draft');

        fireEvent.click(screen.getByTestId('tab-sent'));
        expect(onStatusFilter).toHaveBeenCalledWith('sent');

        fireEvent.click(screen.getByTestId('tab-all'));
        expect(onStatusFilter).toHaveBeenCalledWith(null);
    });

    it('shows empty state when no broadcasts', () => {
        render(<BroadcastList {...defaultProps} broadcasts={[]} />);
        expect(screen.getByTestId('broadcast-empty')).toBeDefined();
        expect(screen.getByText(/No broadcasts yet/)).toBeDefined();
    });
});

describe('BroadcastComposer', () => {
    const defaultProps = {
        onSend: vi.fn(),
        onSaveDraft: vi.fn(),
        onCancel: vi.fn(),
    };

    it('renders the composer form', () => {
        render(<BroadcastComposer {...defaultProps} />);
        expect(screen.getByTestId('broadcast-composer')).toBeDefined();
        expect(screen.getByTestId('broadcast-message')).toBeDefined();
        expect(screen.getByTestId('send-button')).toBeDefined();
        expect(screen.getByTestId('save-draft-button')).toBeDefined();
    });

    it('shows character count', () => {
        render(<BroadcastComposer {...defaultProps} />);
        expect(screen.getByTestId('char-count').textContent).toBe(`0/${MAX_BROADCAST_LENGTH}`);
    });

    it('updates character count as user types', () => {
        render(<BroadcastComposer {...defaultProps} />);
        const textarea = screen.getByTestId('broadcast-message');
        fireEvent.change(textarea, { target: { value: 'Hello world' } });
        expect(screen.getByTestId('char-count').textContent).toBe(`11/${MAX_BROADCAST_LENGTH}`);
    });

    it('shows error when message exceeds character limit', () => {
        render(<BroadcastComposer {...defaultProps} />);
        const textarea = screen.getByTestId('broadcast-message');
        const longMessage = 'x'.repeat(MAX_BROADCAST_LENGTH + 1);
        fireEvent.change(textarea, { target: { value: longMessage } });

        expect(screen.getByTestId('char-limit-error')).toBeDefined();
        expect(screen.getByTestId('char-limit-error').textContent).toBe(
            'Message exceeds character limit',
        );
    });

    it('disables send button when message is empty', () => {
        render(<BroadcastComposer {...defaultProps} />);
        const sendButton = screen.getByTestId('send-button') as HTMLButtonElement;
        expect(sendButton.disabled).toBe(true);
    });

    it('disables send button when over character limit', () => {
        render(<BroadcastComposer {...defaultProps} />);
        const textarea = screen.getByTestId('broadcast-message');
        fireEvent.change(textarea, { target: { value: 'x'.repeat(MAX_BROADCAST_LENGTH + 1) } });
        const sendButton = screen.getByTestId('send-button') as HTMLButtonElement;
        expect(sendButton.disabled).toBe(true);
    });

    it('enables send button with valid message', () => {
        render(<BroadcastComposer {...defaultProps} />);
        const textarea = screen.getByTestId('broadcast-message');
        fireEvent.change(textarea, { target: { value: 'A valid broadcast message' } });
        const sendButton = screen.getByTestId('send-button') as HTMLButtonElement;
        expect(sendButton.disabled).toBe(false);
    });

    it('calls onSend with form data when Send is clicked', () => {
        const onSend = vi.fn();
        render(<BroadcastComposer {...defaultProps} onSend={onSend} />);
        const textarea = screen.getByTestId('broadcast-message');
        fireEvent.change(textarea, { target: { value: 'Test message' } });
        fireEvent.click(screen.getByTestId('send-button'));

        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Test message',
                audienceType: 'all',
                audienceAccountIds: [],
                senderId: 'tm-3',
            }),
        );
    });

    it('calls onSaveDraft with form data when Save Draft is clicked', () => {
        const onSaveDraft = vi.fn();
        render(<BroadcastComposer {...defaultProps} onSaveDraft={onSaveDraft} />);
        const textarea = screen.getByTestId('broadcast-message');
        fireEvent.change(textarea, { target: { value: 'Draft message' } });
        fireEvent.click(screen.getByTestId('save-draft-button'));

        expect(onSaveDraft).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Draft message',
            }),
        );
    });

    it('calls onCancel when Cancel is clicked', () => {
        const onCancel = vi.fn();
        render(<BroadcastComposer {...defaultProps} onCancel={onCancel} />);
        fireEvent.click(screen.getByTestId('cancel-button'));
        expect(onCancel).toHaveBeenCalledOnce();
    });
});

describe('AudienceSelector', () => {
    const defaultProps = {
        audienceType: 'all' as const,
        selectedAccountIds: [] as string[],
        onAudienceTypeChange: vi.fn(),
        onAccountsChange: vi.fn(),
    };

    it('renders audience radio buttons', () => {
        render(<AudienceSelector {...defaultProps} />);
        expect(screen.getByTestId('audience-all')).toBeDefined();
        expect(screen.getByTestId('audience-specific')).toBeDefined();
    });

    it('does not show account list when "All accounts" is selected', () => {
        render(<AudienceSelector {...defaultProps} />);
        expect(screen.queryByTestId('account-list')).toBeNull();
    });

    it('shows account list when "Specific accounts" is selected', () => {
        render(<AudienceSelector {...defaultProps} audienceType="specific" />);
        expect(screen.getByTestId('account-list')).toBeDefined();
    });

    it('calls onAudienceTypeChange when radio is toggled', () => {
        const onAudienceTypeChange = vi.fn();
        render(
            <AudienceSelector
                {...defaultProps}
                onAudienceTypeChange={onAudienceTypeChange}
            />,
        );
        fireEvent.click(screen.getByTestId('audience-specific'));
        expect(onAudienceTypeChange).toHaveBeenCalledWith('specific');
    });

    it('calls onAccountsChange when an account checkbox is toggled', () => {
        const onAccountsChange = vi.fn();
        render(
            <AudienceSelector
                {...defaultProps}
                audienceType="specific"
                onAccountsChange={onAccountsChange}
            />,
        );
        fireEvent.click(screen.getByTestId('account-acc-1'));
        expect(onAccountsChange).toHaveBeenCalledWith(['acc-1']);
    });

    it('removes account from selection when unchecked', () => {
        const onAccountsChange = vi.fn();
        render(
            <AudienceSelector
                {...defaultProps}
                audienceType="specific"
                selectedAccountIds={['acc-1', 'acc-2']}
                onAccountsChange={onAccountsChange}
            />,
        );
        fireEvent.click(screen.getByTestId('account-acc-1'));
        expect(onAccountsChange).toHaveBeenCalledWith(['acc-2']);
    });
});

describe('SenderPicker', () => {
    const defaultProps = {
        selectedSenderId: 'tm-3',
        onSenderChange: vi.fn(),
    };

    it('renders all team members', () => {
        render(<SenderPicker {...defaultProps} />);
        expect(screen.getByTestId('sender-tm-1')).toBeDefined();
        expect(screen.getByTestId('sender-tm-2')).toBeDefined();
        expect(screen.getByTestId('sender-tm-3')).toBeDefined();
    });

    it('calls onSenderChange when a sender is clicked', () => {
        const onSenderChange = vi.fn();
        render(<SenderPicker {...defaultProps} onSenderChange={onSenderChange} />);
        fireEvent.click(screen.getByTestId('sender-tm-1'));
        expect(onSenderChange).toHaveBeenCalledWith('tm-1');
    });
});
