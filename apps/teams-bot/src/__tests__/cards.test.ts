import { describe, it, expect } from 'vitest';
import { buildResponseCard } from '../cards/response-card.js';
import { buildTicketCreatedCard } from '../cards/ticket-created-card.js';
import { buildEscalationCard } from '../cards/escalation-card.js';

/**
 * Every text block in a card body, flattened. Used by the leak assertions
 * below so a displayId can't reappear in a block index nobody checks.
 */
function allCardText(card: Record<string, unknown>): string {
    const body = card.body as Array<{ text?: string }>;
    return body.map((b) => b.text ?? '').join('\n');
}

describe('buildResponseCard', () => {
    it('builds a card with action buttons', () => {
        const card = buildResponseCard({
            responseText: 'Here is the answer.',
            confidence: 0.9,
        });

        expect(card.type).toBe('AdaptiveCard');
        expect(card.version).toBe('1.4');

        const body = card.body as Array<{ text: string }>;
        expect(body[0].text).toBe('AI Response');
        expect(body[1].text).toBe('Here is the answer.');

        const actions = card.actions as Array<{ title: string; data: { action: string } }>;
        expect(actions).toHaveLength(2);
        expect(actions[0].title).toBe('Issue Solved');
        expect(actions[0].data.action).toBe('issue_solved');
        expect(actions[1].title).toBe('Need more help');
        expect(actions[1].data.action).toBe('need_more_help');
    });

    it('carries no ticket identifier anywhere — not in text, not in action data', () => {
        const card = buildResponseCard({
            responseText: 'Here is the answer.',
            confidence: 0.9,
        });

        expect(allCardText(card)).not.toMatch(/TKT-/);

        // `data` ships to the reporter's client too, so the action payloads must
        // carry nothing but the action name.
        const actions = card.actions as Array<{ data: Record<string, unknown> }>;
        for (const action of actions) {
            expect(Object.keys(action.data)).toEqual(['action']);
        }

        // Catch-all: no identifier-shaped field anywhere in the serialized card.
        expect(JSON.stringify(card)).not.toMatch(/[Dd]isplayId|TKT-/);
    });

    it('includes a low-confidence disclaimer when confidence is below threshold', () => {
        const card = buildResponseCard({
            responseText: 'Not sure about this.',
            confidence: 0.5,
        });

        const body = card.body as Array<{ text: string }>;
        expect(body).toHaveLength(3);
        expect(body[2].text).toContain('lower confidence');
    });

    it('does not include disclaimer when confidence is high', () => {
        const card = buildResponseCard({
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
            title: 'Help with integration',
        });

        expect(card.type).toBe('AdaptiveCard');
        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe('Help with integration');
        expect(body[2].text).toContain('AI assistant');
    });

    it('never renders a ticket displayId — the option does not exist', () => {
        const card = buildTicketCreatedCard({ title: 'Help with integration' });

        expect(allCardText(card)).not.toMatch(/TKT-/);
    });
});

describe('buildEscalationCard', () => {
    it('builds an escalation notification card', () => {
        const card = buildEscalationCard({
            reason: 'User needs more help.',
        });

        expect(card.type).toBe('AdaptiveCard');
        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe('User needs more help.');
        expect(body[2].text).toContain('team member');
    });

    it('never renders a ticket displayId — the option does not exist', () => {
        const card = buildEscalationCard({ reason: 'User needs more help.' });

        expect(allCardText(card)).not.toMatch(/TKT-/);
    });
});
