import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationThread } from '@/components/tickets/conversation-thread';
import { MessageType } from '@copilotkit/outpost/shared';
import type { TicketMessage } from '@/components/tickets/types';

// jsdom does not implement Element.scrollTo; ConversationThread calls it on
// mount to scroll to the latest message.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});

function makeMessage(overrides: Partial<TicketMessage> = {}): TicketMessage {
    return {
        id: 'msg-1',
        ticketId: 'tkt-1',
        author: 'Outpost AI',
        content: 'An answer',
        type: MessageType.BOT,
        isAiGenerated: true,
        confidenceLevel: null,
        attachments: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe('ConversationThread confidence badge', () => {
    it('renders the confidence badge for an AI message with a confidence level', () => {
        render(<ConversationThread messages={[makeMessage({ confidenceLevel: 'HIGH' })]} />);
        const badge = screen.getByTestId('confidence-badge');
        expect(badge).toHaveAttribute('data-level', 'HIGH');
    });

    it('does not render a confidence badge for a message with no confidence level', () => {
        render(<ConversationThread messages={[makeMessage({ confidenceLevel: null })]} />);
        expect(screen.queryByTestId('confidence-badge')).not.toBeInTheDocument();
    });

    it('does not render a confidence badge for a non-AI message', () => {
        render(
            <ConversationThread
                messages={[
                    makeMessage({
                        isAiGenerated: false,
                        type: MessageType.USER,
                        confidenceLevel: null,
                    }),
                ]}
            />,
        );
        expect(screen.queryByTestId('confidence-badge')).not.toBeInTheDocument();
    });
});
