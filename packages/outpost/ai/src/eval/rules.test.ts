import { describe, it, expect } from 'vitest';
import { checkReply, RULES, HANDOFF_WORD_CAP, MIN_REPLY_WORDS } from './rules.js';
import type { SearchResult } from '../types.js';

const source = (content: string, title = 'CopilotChat'): SearchResult => ({
    title,
    content,
    score: 0.9,
    sourceUrl: 'https://docs.copilotkit.ai/reference/components/chat/CopilotChat',
});

const DOCS = [source('Use the `CopilotChat` component with the `instructions` prop.')];

/** Convenience: the ids of every rule the reply violated. */
const broken = (reply: string, sources: SearchResult[] = DOCS): string[] =>
    checkReply(reply, sources)
        .filter((r) => !r.passed)
        .map((r) => r.rule);

describe('checkReply', () => {
    it('passes a reply that answers with a grounded name and a source', () => {
        expect(
            broken(
                'Use the `CopilotChat` component with the `instructions` prop. ' +
                    'See https://docs.copilotkit.ai/reference/components/chat/CopilotChat',
            ),
        ).toEqual([]);
    });

    it('reports every rule exactly once, pass or fail', () => {
        const results = checkReply('Anything at all.', DOCS);
        expect(results.map((r) => r.rule).sort()).toEqual([...RULES].sort());
        expect(new Set(results.map((r) => r.rule)).size).toBe(RULES.length);
    });
});

// "Zero invented API names — this one is mechanically checkable, so any
// occurrence is a bug, not a judgment call." Delegates to the same
// assessGroundedness the pipeline gates on, so the harness and production
// cannot disagree about what counts as invented.
describe('grounded-identifiers', () => {
    it('fails on a name that appears in none of the sources', () => {
        expect(broken('Call `useCopilotFabricated()` to fix it.')).toContain(
            'grounded-identifiers',
        );
    });

    it('passes a name the sources actually contain', () => {
        expect(broken('Use the `CopilotChat` component.')).not.toContain('grounded-identifiers');
    });

    it('names the offending identifiers in the detail, so a failure is actionable', () => {
        const result = checkReply('Call `useCopilotFabricated()`.', DOCS).find(
            (r) => r.rule === 'grounded-identifiers',
        );
        expect(result?.detail).toContain('useCopilotFabricated');
    });
});

// "Every substantive answer links to the doc page or file it came from. If it
// can't, it becomes a two-sentence handoff instead." So the rule is a
// disjunction, not a flat requirement — a short handoff is allowed to have no
// link, and that is the whole point of it existing.
describe('cites-or-is-a-short-handoff', () => {
    it('fails a long answer that cites nothing', () => {
        const wordy = 'You can configure this in several ways. '.repeat(12);
        expect(broken(wordy)).toContain('cites-or-is-a-short-handoff');
    });

    it('passes a long answer that links the docs', () => {
        const wordy =
            'You can configure this in several ways. '.repeat(12) +
            ' https://docs.copilotkit.ai/guides/configuration';
        expect(broken(wordy)).not.toContain('cites-or-is-a-short-handoff');
    });

    it('passes a long answer that links a repo file, since code is a real answer', () => {
        const wordy =
            'This is handled by the adapter. '.repeat(12) +
            ' https://github.com/CopilotKit/CopilotKit/blob/main/packages/runtime/src/agent.ts';
        expect(broken(wordy)).not.toContain('cites-or-is-a-short-handoff');
    });

    it('passes a short handoff with no link at all', () => {
        expect(
            broken('Confirmed the manifest and lockfile skew. Routing this to the team.'),
        ).not.toContain('cites-or-is-a-short-handoff');
    });
});

// "Nothing found -> two sentences, done." A no-answer that runs to 400 words is
// the single thing the doc says changes the feel of the product most.
describe('the handoff cap', () => {
    it('fails a handoff that pads past the cap', () => {
        const padded =
            'A human will follow up here shortly. ' +
            'In the meantime here is some general background. '.repeat(20);
        const results = checkReply(padded, DOCS);
        const rule = results.find((r) => r.rule === 'cites-or-is-a-short-handoff');
        expect(rule?.passed).toBe(false);
        expect(rule?.detail).toContain(String(HANDOFF_WORD_CAP));
    });

    it('does not apply the cap to an answer that carries a source', () => {
        const long =
            'Use the `CopilotChat` component. '.repeat(30) +
            ' https://docs.copilotkit.ai/reference/components/chat/CopilotChat';
        expect(broken(long)).not.toContain('cites-or-is-a-short-handoff');
    });
});

// Every other rule is a prohibition, so without this one the score is maximised
// by saying nothing — and an agent regressing toward empty replies would read as
// the score improving.
describe('says-something', () => {
    it.each(['', '   ', 'No.', 'Escalating.', 'Routing this to the team.'])(
        'fails %o, which is not a reply',
        (reply) => {
            expect(broken(reply, [])).toContain('says-something');
        },
    );

    it('passes the shortest reply the doc actually endorses', () => {
        // The reference handoff, quoted in the doc as the right answer for case D.
        expect(
            broken('Confirmed the manifest and lockfile skew. Routing this to the team — someone will follow up here.'),
        ).toEqual([]);
    });

    it('reports the word count so a failure is actionable', () => {
        const result = checkReply('No.', DOCS).find((r) => r.rule === 'says-something');
        expect(result?.detail).toContain('1 words');
        expect(MIN_REPLY_WORDS).toBeGreaterThan(1);
    });
});

// "Never mention @copilotkitnext" is right as a default and wrong as an
// absolute: the reporter importing from it needs to be told what to import
// instead, and under a flat ban that reply is the one that cannot be given.
describe('the migration answer', () => {
    it('allows naming the dead package when the live one is named too', () => {
        expect(
            broken(
                "You're importing from `@copilotkitnext/react`, which merged into " +
                    '`@copilotkit/react-core` v2 — switch the import and the hook names carry over.',
            ),
        ).not.toContain('no-dead-package');
    });

    it('still fails a stray reference with no replacement named', () => {
        expect(broken('Install `@copilotkitnext/react` first and then retry the build.')).toContain(
            'no-dead-package',
        );
    });
});

// "Never talk about the agent's own limits", "no praise openers", "never claim it
// can't see the thread", "don't coach people on how to write better issues".
// Case D was five paragraphs of exactly these.
describe('no-banned-phrases', () => {
    it.each([
        'Great question! Use the `CopilotChat` component.',
        "Thanks for this detailed report. Use the `CopilotChat` component.",
        "Here is what I can't do from here: read the source.",
        "I can't see other people's replies in this thread.",
        'In the future, please include a minimal reproduction in your issue.',
    ])('fails on %s', (reply) => {
        expect(broken(reply)).toContain('no-banned-phrases');
    });

    it('passes a reply that just answers', () => {
        expect(broken('Use the `CopilotChat` component.')).not.toContain('no-banned-phrases');
    });

    // The phrase list must not fire on ordinary prose that happens to contain a
    // banned word, or the linter collapses correct answers into handoffs.
    it('does not fire on innocent uses of the same words', () => {
        expect(
            broken('The `instructions` prop question comes up often; see the docs.'),
        ).not.toContain('no-banned-phrases');
    });
});

// "Never hedge a name. 'or the equivalent hook' means the agent is guessing."
describe('no-hedged-names', () => {
    it('fails on a hedged identifier', () => {
        expect(broken('Use `CopilotChat` or the equivalent render hook.')).toContain(
            'no-hedged-names',
        );
    });

    it('passes an unhedged one', () => {
        expect(broken('Use the `CopilotChat` component.')).not.toContain('no-hedged-names');
    });
});

// "Never mention @copilotkitnext. It's dead — it merged into v2."
describe('no-dead-package', () => {
    it('fails on a mention of the retired package', () => {
        expect(broken('Install `@copilotkitnext/react` first.')).toContain('no-dead-package');
    });

    it('passes the live package', () => {
        expect(broken('Install `@copilotkit/react-core` first.')).not.toContain('no-dead-package');
    });
});
