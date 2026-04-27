import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BroadcastList } from '@/components/broadcasts/broadcast-list';
import type { Broadcast } from '@/components/broadcasts/broadcast-list';
import { BroadcastComposer } from '@/components/broadcasts/broadcast-composer';
import { AudienceSelector } from '@/components/broadcasts/audience-selector';
import type { AccountOption } from '@/components/broadcasts/audience-selector';
import { SenderPicker } from '@/components/broadcasts/sender-picker';
import type { TeamMemberOption } from '@/components/broadcasts/sender-picker';

const MAX_BROADCAST_LENGTH = 500;

const TEST_ACCOUNTS: AccountOption[] = [
    { id: 'acc-1', name: 'Acme Corp' },
    { id: 'acc-2', name: 'TechStart Inc' },
    { id: 'acc-3', name: 'DataFlow Labs' },
];

const TEST_TEAM_MEMBERS: TeamMemberOption[] = [
    { id: 'tm-1', name: 'Atai Barkai', email: 'atai@copilotkit.ai' },
    { id: 'tm-2', name: 'Markus Ecker', email: 'markus@copilotkit.ai' },
    { id: 'tm-3', name: 'Jordan Ritter', email: 'jordan@copilotkit.ai' },
];

const TEST_BROADCASTS: Broadcast[] = [
    {
        id: 'bc-1',
        message: 'We are excited to announce CopilotKit v2.0 with full streaming support.',
        sendAs: 'Atai Barkai',
        audience: 'ALL_ACCOUNTS',
        targetAccounts: [],
        status: 'SENT',
        sentAt: '2025-03-10T09:05:00Z',
        createdAt: '2025-03-10T09:00:00Z',
        updatedAt: '2025-03-10T09:05:00Z',
    },
    {
        id: 'bc-2',
        message: 'Scheduled maintenance window: Our API will undergo maintenance on March 20th.',
        sendAs: 'Jordan Ritter',
        audience: 'ALL_ACCOUNTS',
        targetAccounts: [],
        status: 'SENT',
        sentAt: '2025-03-15T14:30:00Z',
        createdAt: '2025-03-15T14:00:00Z',
        updatedAt: '2025-03-15T14:30:00Z',
    },
    {
        id: 'bc-3',
        message: 'Your dedicated support engineer has changed.',
        sendAs: 'Markus Ecker',
        audience: 'SELECTED_ACCOUNTS',
        targetAccounts: ['acc-1', 'acc-3'],
        status: 'SENT',
        sentAt: '2025-03-18T11:15:00Z',
        createdAt: '2025-03-18T11:00:00Z',
        updatedAt: '2025-03-18T11:15:00Z',
    },
    {
        id: 'bc-4',
        message: 'Draft: Introducing our new Enterprise tier with priority support.',
        sendAs: 'Atai Barkai',
        audience: 'ALL_ACCOUNTS',
        targetAccounts: [],
        status: 'DRAFT',
        sentAt: null,
        createdAt: '2025-03-20T16:00:00Z',
        updatedAt: '2025-03-20T16:00:00Z',
    },
    {
        id: 'bc-5',
        message: 'Draft: We noticed your team has not yet migrated to the v2 SDK.',
        sendAs: 'Jordan Ritter',
        audience: 'SELECTED_ACCOUNTS',
        targetAccounts: ['acc-2'],
        status: 'DRAFT',
        sentAt: null,
        createdAt: '2025-03-22T10:00:00Z',
        updatedAt: '2025-03-22T10:00:00Z',
    },
];

describe('BroadcastList', () => {
    const defaultProps = {
        broadcasts: TEST_BROADCASTS,
        onStatusFilter: vi.fn(),
        activeFilter: null as 'DRAFT' | 'SENT' | null,
        loading: false,
    };

    it('renders all filter tabs (All, Draft, Sent)', () => {
        render(<BroadcastList {...defaultProps} />);
        expect(screen.getByTestId('tab-all')).toBeDefined();
        expect(screen.getByTestId('tab-draft')).toBeDefined();
        expect(screen.getByTestId('tab-sent')).toBeDefined();
    });

    it('renders broadcast cards for each broadcast', () => {
        render(<BroadcastList {...defaultProps} />);
        for (const bc of TEST_BROADCASTS) {
            expect(screen.getByTestId(`broadcast-card-${bc.id}`)).toBeDefined();
        }
    });

    it('displays correct status badges', () => {
        render(<BroadcastList {...defaultProps} />);
        const draftBroadcasts = TEST_BROADCASTS.filter((b) => b.status === 'DRAFT');
        const sentBroadcasts = TEST_BROADCASTS.filter((b) => b.status === 'SENT');

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
        expect(onStatusFilter).toHaveBeenCalledWith('DRAFT');

        fireEvent.click(screen.getByTestId('tab-sent'));
        expect(onStatusFilter).toHaveBeenCalledWith('SENT');

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
        accounts: TEST_ACCOUNTS,
        teamMembers: TEST_TEAM_MEMBERS,
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
        accounts: TEST_ACCOUNTS,
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
        teamMembers: TEST_TEAM_MEMBERS,
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
