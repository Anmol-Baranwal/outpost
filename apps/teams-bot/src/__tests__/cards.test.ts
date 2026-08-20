import { describe, it, expect } from 'vitest';
import { buildResponseCard } from '../cards/response-card.js';
import {
    buildTicketCreatedCard,
    type TicketCreatedCardOptions,
} from '../cards/ticket-created-card.js';
import { buildEscalationCard, type EscalationCardOptions } from '../cards/escalation-card.js';

/**
 * Key whose value is an Action.Submit payload: sent back to the bot on click,
 * never displayed. Everything else in a card is potentially rendered, so the
 * leak guards below look at all of it.
 */
const SUBMIT_PAYLOAD_KEY = 'data';

/**
 * Every string a Teams client could put on screen for this card, at any nesting
 * depth: `body[].text`, text inside nested containers/columns/sets, and
 * `actions[].title` — plus any other string field a future card shape adds.
 *
 * Deliberately a denylist (skip `data`) rather than an allowlist of known
 * rendered keys, so a displayId reintroduced into a field this test has never
 * heard of still trips the guard.
 */
function visibleCardStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(visibleCardStrings);
    if (value !== null && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== SUBMIT_PAYLOAD_KEY)
            .flatMap(([, nested]) => visibleCardStrings(nested));
    }
    return [];
}

/** The visible strings joined, for substring/regex assertions. */
function visibleCardText(card: Record<string, unknown>): string {
    return visibleCardStrings(card).join('\n');
}

describe('visibleCardStrings (the leak guards depend on this)', () => {
    it('finds text nested inside containers and action titles, and skips submit payloads', () => {
        const card = {
            type: 'AdaptiveCard',
            body: [
                { type: 'TextBlock', text: 'top-level' },
                {
                    type: 'Container',
                    items: [
                        { type: 'TextBlock', text: 'nested-once' },
                        { type: 'ColumnSet', columns: [{ items: [{ text: 'nested-twice' }] }] },
                    ],
                },
            ],
            actions: [
                {
                    type: 'Action.Submit',
                    title: 'action-title',
                    data: { ticketDisplayId: 'TKT-INPAYLOAD' },
                },
            ],
        };

        const found = visibleCardStrings(card);
        expect(found).toContain('top-level');
        expect(found).toContain('nested-once');
        expect(found).toContain('nested-twice');
        expect(found).toContain('action-title');
        expect(found).not.toContain('TKT-INPAYLOAD');
    });
});

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

    // There is deliberately NO "responseText carries no TKT-" guard here. The card
    // has no displayId input any more, so the only way an identifier reaches it is
    // through `responseText` — the pipeline's own output, which this card renders
    // verbatim by contract. A guard fed a TKT- responseText would fail correctly
    // and a guard fed clean text cannot fail at all, so what is worth pinning is
    // that the BUILDER never adds an identifier of its own: that is the assertion
    // below, over the whole serialized card, across both body shapes.
    it.each([
        ['high confidence', 0.9],
        ['low confidence (extra disclaimer block)', 0.5],
    ])('carries nothing but the action name in its submit payloads — %s', (_label, confidence) => {
        // `data` ships to the reporter's client too. It used to carry the ticket
        // displayId on the claim that clicks needed it to resolve; card-actions.ts
        // ignores `data` entirely and resolves by conversation id, so the field
        // was dead payload. This pins it staying gone.
        const card = buildResponseCard({
            responseText: 'Here is the answer.',
            confidence,
        });

        const actions = card.actions as Array<{ data: Record<string, unknown> }>;
        for (const action of actions) {
            expect(Object.keys(action.data)).toEqual(['action']);
        }

        // Catch-all across the whole serialized card, submit payloads included.
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
            aiJobEnqueued: true,
        });

        expect(card.type).toBe('AdaptiveCard');
        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe('Help with integration');
        expect(body[2].text).toContain('AI assistant');
    });

    it('ignores a ticketDisplayId even when one is handed to it', () => {
        // The regression this guards: someone re-adds a displayId to the options
        // and renders it into reporter-facing copy. Passing the leak-carrying
        // property today is a no-op; the day the builder reads it, this fails.
        const card = buildTicketCreatedCard({
            title: 'Help with integration',
            aiJobEnqueued: true,
            ticketDisplayId: 'TKT-LEAK01',
        } as TicketCreatedCardOptions);

        expect(visibleCardText(card)).not.toContain('TKT-LEAK01');
        expect(visibleCardText(card)).not.toMatch(/TKT-/);
        // The bare token too: `title` is Markdown-escaped now, so a rendered
        // 'TKT-LEAK01' would arrive as 'TKT\\-LEAK01' and slip past the two
        // assertions above.
        expect(visibleCardText(card)).not.toContain('LEAK01');
    });

    it.each([
        [
            'a link',
            '[click here](https://phish.example)',
            '\\[click here\\]\\(https://phish.example\\)',
        ],
        ['bold', 'this is **urgent**', 'this is \\*\\*urgent\\*\\*'],
        ['a heading', '# ship it', '\\# ship it'],
        ['a code span', 'run `rm -rf /`', 'run \\`rm \\-rf /\\`'],
        ['a bullet list', '- one\n- two', '\\- one\n\\- two'],
        [
            'an image',
            '![](https://tracker.example/x.png)',
            '\\!\\[\\]\\(https://tracker.example/x.png\\)',
        ],
    ])('escapes reporter-supplied Markdown in the title — %s', (_label, title, expected) => {
        // A TextBlock renders its text as Markdown in Teams and there is no flag
        // to turn that off, so unescaped reporter text made the reporter the
        // author of markup inside the bot's own card — a link they typed became a
        // real, bot-endorsed link. Escaped, it renders as the literal characters.
        const card = buildTicketCreatedCard({ title, aiJobEnqueued: true });

        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe(expected);
    });

    it('leaves text with no Markdown characters untouched', () => {
        // Escaping must not tax ordinary sentences with stray backslashes.
        const card = buildTicketCreatedCard({
            title: 'CopilotKit runtime returns 500 on Next 15',
            aiJobEnqueued: true,
        });

        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe('CopilotKit runtime returns 500 on Next 15');
    });

    it('escapes the title without hiding an identifier the caller put there', () => {
        // The contract changed only for Markdown: this builder now owns
        // neutralizing reporter-controlled markup. It still does not sanitize in
        // any other sense — escaping does not remove a displayId — so callers
        // remain responsible for keeping internal identifiers out of `title`.
        const card = buildTicketCreatedCard({
            title: 'my ref is TKT-USERTYPED',
            aiJobEnqueued: true,
        });

        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe('my ref is TKT\\-USERTYPED');
        expect(body[1].text).toContain('my ref is');
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

    it('ignores a ticketDisplayId even when one is handed to it', () => {
        const card = buildEscalationCard({
            reason: 'User needs more help.',
            ticketDisplayId: 'TKT-LEAK02',
        } as EscalationCardOptions);

        expect(visibleCardText(card)).not.toContain('TKT-LEAK02');
        expect(visibleCardText(card)).not.toMatch(/TKT-/);
    });

    it('echoes the caller-supplied reason verbatim', () => {
        // Same boundary as the ack card: `reason` is rendered as-is (the only
        // call site passes a static literal), so callers own keeping displayIds
        // out of it.
        const card = buildEscalationCard({ reason: 'escalated from TKT-CALLERTEXT' });

        const body = card.body as Array<{ text: string }>;
        expect(body[1].text).toBe('escalated from TKT-CALLERTEXT');
    });
});
