import { describe, it, expect } from 'vitest';
import { buildResponseCard } from '../cards/response-card.js';
import { buildTicketCreatedCard } from '../cards/ticket-created-card.js';
import { buildEscalationCard } from '../cards/escalation-card.js';

describe('buildResponseCard', () => {
    it('builds a card with action buttons', () => {
        const card = buildResponseCard({
            ticketDisplayId: 'TKT-AB12',
            responseText: 'Here is the answer.',
            confidence: 0.9,
        });

        expect(card.type).toBe('AdaptiveCard');
        expect(card.version).toBe('1.4');

        const body = card.body as Array<{ text: string }>;
        expect(body[0].text).toContain('TKT-AB12');
        expect(body[1].text).toBe('Here is the answer.');

        const actions = card.actions as Array<{ title: string; data: { action: string } }>;
        expect(actions).toHaveLength(2);
        expect(actions[0].title).toBe('Issue Solved');
        expect(actions[0].data.action).toBe('issue_solved');
        expect(actions[1].title).toBe('Need more help');
        expect(actions[1].data.action).toBe('need_more_help');
    });

    it('includes a low-confidence disclaimer when confidence is below threshold', () => {
        const card = buildResponseCard({
            ticketDisplayId: 'TKT-AB12',
            responseText: 'Not sure about this.',
            confidence: 0.5,
        });

        const body = card.body as Array<{ text: string }>;
        expect(body).toHaveLength(3);
        expect(body[2].text).toContain('lower confidence');
    });

    it('does not include disclaimer when confidence is high', () => {
        const card = buildResponseCard({
            ticketDisplayId: 'TKT-AB12',
            responseText: 'Confident answer.',
            confidence: 0.85,
        });

        const body = card.body as Array<{ text: string }>;
        expect(body).toHaveLength(2);
    });
});

describe('buildTicketCreatedCard', () => {
    it('builds a ticket acknowledgment card', () => {
        const card = buildTicketCreatedCard({
            ticketDisplayId: 'TKT-CD34',
            title: 'Help with integration',
        });

        expect(card.type).toBe('AdaptiveCard');
        const body = card.body as Array<{ text: string }>;
        expect(body[0].text).toContain('TKT-CD34');
        expect(body[1].text).toBe('Help with integration');
        expect(body[2].text).toContain('AI assistant');
    });
});

describe('buildEscalationCard', () => {
    it('builds an escalation notification card', () => {
        const card = buildEscalationCard({
            ticketDisplayId: 'TKT-EF56',
            reason: 'User needs more help.',
        });

        expect(card.type).toBe('AdaptiveCard');
        const body = card.body as Array<{ text: string }>;
        expect(body[0].text).toContain('TKT-EF56');
        expect(body[1].text).toBe('User needs more help.');
        expect(body[2].text).toContain('team member');
    });
});
