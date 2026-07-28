import { describe, it, expect } from 'vitest';
import {
    assessGroundedness,
    extractCopilotKitIdentifiers,
    MAX_GROUNDEDNESS_PENALTY,
    SUPPRESS_AT_UNSOURCED_IDENTIFIERS,
} from './groundedness.js';
import type { SearchResult } from './types.js';

const source = (content: string, title = 'CopilotChat'): SearchResult => ({
    title,
    content,
    score: 0.9,
    sourceUrl: 'https://docs.copilotkit.ai/reference/components/chat/CopilotChat',
});

/** The docs page the #6167 query actually retrieved — no cursor/CSS internals on it. */
const CHAT_DOCS = [
    source(
        'CopilotChat renders a chat window. Use the `CopilotChat` component with the ' +
            '`instructions` prop. Slots let you replace the input via the `input` prop.',
    ),
];

describe('extractCopilotKitIdentifiers', () => {
    it('picks up CopilotKit CSS class selectors', () => {
        const ids = extractCopilotKitIdentifiers(
            'Override `.copilotKitInputControls` and .copilotKitInputControlsExpanded to fix it.',
        );
        expect(ids).toContain('copilotKitInputControls');
        expect(ids).toContain('copilotKitInputControlsExpanded');
    });

    it('picks up backticked CopilotKit identifiers but not call expressions', () => {
        // Both tokens carry our name; only the bare identifier is a claim about an
        // API surface we can check against the sources. `foo()` is prose-with-code,
        // and the shape guard — not a missing "copilotkit" — is what rejects it.
        expect(extractCopilotKitIdentifiers('Call `useCopilotKitInternals()` first.')).toEqual([]);
        expect(extractCopilotKitIdentifiers('Call `useCopilotKitInternals` first.')).toContain(
            'useCopilotKitInternals',
        );
    });

    it('ignores generic React vocabulary so real answers are not penalized', () => {
        const ids = extractCopilotKitIdentifiers(
            'Use `useRef`, `useLayoutEffect` and `setSelectionRange` to restore the cursor.',
        );
        expect(ids).toEqual([]);
    });

    it('ignores @copilotkit package specifiers', () => {
        const ids = extractCopilotKitIdentifiers(
            'Install `@copilotkit/react-core` and `@copilotkit/react-ui`.',
        );
        expect(ids).toEqual([]);
    });

    it('ignores prose and code fences that are not identifiers', () => {
        const ids = extractCopilotKitIdentifiers(
            'The `CopilotKit provider wraps your app` sentence is not an identifier.',
        );
        expect(ids).toEqual([]);
    });

    it('deduplicates repeated mentions', () => {
        const ids = extractCopilotKitIdentifiers(
            '.copilotKitInput and .copilotKitInput again and `copilotKitInput`',
        );
        expect(ids).toEqual(['copilotKitInput']);
    });

    // Grounding compares case-insensitively, so dedup must too: otherwise two
    // spellings of one invented name count as two fabrications and clear the
    // suppression bar on their own.
    it('deduplicates case variants, keeping the first spelling seen', () => {
        const ids = extractCopilotKitIdentifiers('Use .copilotKitFoo, then .CopilotKitFoo.');
        expect(ids).toEqual(['copilotKitFoo']);
    });

    // The prompt tells the bot to cite docs URLs, so the hostname shows up in most
    // good answers. A URL is never a declaration of an identifier.
    it('never mines identifiers out of URLs', () => {
        expect(
            extractCopilotKitIdentifiers('See https://docs.copilotkit.ai/reference/chat for docs.'),
        ).toEqual([]);
    });
});

describe('assessGroundedness', () => {
    it('gives a grounded answer no penalty and does not suppress it', () => {
        const response =
            'You can replace the chat input with the `input` prop on the `CopilotChat` component. ' +
            'That keeps your own state, so you control the cursor.';

        const result = assessGroundedness(response, CHAT_DOCS);

        expect(result.penalty).toBe(0);
        expect(result.suppress).toBe(false);
        expect(result.reasons).toEqual([]);
    });

    it('flags a confirmed-bug claim and suppresses the response', () => {
        const result = assessGroundedness(
            '## Bug Confirmed: Cursor Jump in Expanded Mode\n\nThanks for the repro steps!',
            CHAT_DOCS,
        );

        expect(result.unverifiedClaims).toContain('"bug confirmed"');
        expect(result.penalty).toBeGreaterThan(0);
        expect(result.suppress).toBe(true);
    });

    it.each([
        ['Root Cause: React resets the cursor.', 'asserts a root cause'],
        ['This is a real bug worth fixing in the core.', 'asserts the report is a real bug'],
        ['This is a known issue in the chat input.', 'claims a known bug'],
        ['The fix is to save and restore the selection.', 'asserts the fix'],
        ['I reproduced this locally on the latest version.', 'claims to have reproduced or tested'],
        ['We ran the tests and they pass.', 'claims to have reproduced or tested'],
    ])('suppresses %j', (response, expectedLabel) => {
        const result = assessGroundedness(response, CHAT_DOCS);
        expect(result.unverifiedClaims).toContain(expectedLabel);
        expect(result.suppress).toBe(true);
    });

    // Suppression is user-visible — the reporter gets the no-answer reply instead
    // of a real one — so a false positive costs more than a missed one. These are
    // all well-behaved responses of exactly the kind the prompt asks for.
    describe('negated claims', () => {
        it.each([
            'This is not a known issue as far as the docs show.',
            "I can't determine what the root cause is without reproducing it.",
            "I don't know what the fix is — engineering will need to confirm.",
            'I have not reproduced this myself.',
            "We haven't tested this against your version.",
            "It's unclear whether this is a real bug or expected behavior.",
            'No bug confirmed here — the docs describe this as intended.',
        ])('does not suppress %j', (response) => {
            const result = assessGroundedness(response, CHAT_DOCS);
            expect(result.unverifiedClaims).toEqual([]);
            expect(result.suppress).toBe(false);
        });

        it('still catches an assertion in a later sentence', () => {
            // The negation belongs to the first sentence only.
            const result = assessGroundedness(
                'I have not reproduced this. Root cause is a re-render on every keystroke.',
                CHAT_DOCS,
            );
            expect(result.unverifiedClaims).toContain('asserts a root cause');
            expect(result.suppress).toBe(true);
        });

        it('still catches an assertive occurrence when another is negated', () => {
            const result = assessGroundedness(
                "It's unclear whether the root cause is the layout. Bug confirmed regardless.",
                CHAT_DOCS,
            );
            expect(result.unverifiedClaims).toContain('"bug confirmed"');
            expect(result.suppress).toBe(true);
        });
    });

    it('flags invented class names regardless of case', () => {
        for (const response of [
            'Override `.copilotkit-input-controls` to fix it.',
            'Override `.CopilotKitInputControls` to fix it.',
        ]) {
            const result = assessGroundedness(response, CHAT_DOCS);
            expect(result.unsourcedIdentifiers).toHaveLength(1);
            expect(result.penalty).toBeGreaterThan(0);
        }
    });

    it('penalizes an identifier absent from every source', () => {
        const result = assessGroundedness(
            'Override `.copilotKitInputControls` to force compact mode.',
            CHAT_DOCS,
        );

        expect(result.unsourcedIdentifiers).toEqual(['copilotKitInputControls']);
        expect(result.penalty).toBeCloseTo(0.15, 5);
        // A single identifier is a penalty, not a block — it could be a typo.
        expect(result.suppress).toBe(false);
    });

    it('does not penalize an identifier the sources actually document', () => {
        const result = assessGroundedness(
            'Style the input with `.copilotKitInput` as shown in the docs.',
            [source('Override .copilotKitInput to restyle the chat input.')],
        );

        expect(result.unsourcedIdentifiers).toEqual([]);
        expect(result.penalty).toBe(0);
    });

    it('matches identifiers against source titles as well as bodies', () => {
        const result = assessGroundedness('Use `copilotKitSidebar` here.', [
            source('Layout options for the sidebar.', 'copilotKitSidebar reference'),
        ]);

        expect(result.unsourcedIdentifiers).toEqual([]);
    });

    it('suppresses once two identifiers are invented', () => {
        const result = assessGroundedness(
            'Override `.copilotKitInputControls` and `.copilotKitInputControlsExpanded`.',
            CHAT_DOCS,
        );

        expect(result.unsourcedIdentifiers).toHaveLength(2);
        expect(result.suppress).toBe(true);
    });

    it('allows a couple of hedges but penalizes a pile of them', () => {
        const twoHedges = assessGroundedness(
            'This is likely a re-render, and the class names may vary by version.',
            CHAT_DOCS,
        );
        expect(twoHedges.penalty).toBe(0);

        const manyHedges = assessGroundedness(
            'This is likely a re-render. It probably resets state. The names may vary. ' +
                'I think the layout might be recalculating, though I am not sure.',
            CHAT_DOCS,
        );
        expect(manyHedges.penalty).toBeGreaterThan(0);
        expect(manyHedges.hedgeCount).toBeGreaterThan(2);
        // Hedging alone is a smell, not a fabrication — never blocks on its own.
        expect(manyHedges.suppress).toBe(false);
    });

    it('caps the total penalty', () => {
        const kitchenSink =
            'Bug Confirmed. Root cause is a re-render. This is a known issue. The fix is simple. ' +
            'I reproduced it. Override `.copilotKitA`, `.copilotKitB`, `.copilotKitC`, ' +
            '`.copilotKitD`, `.copilotKitE`. Likely, probably, might be, may vary, I think.';

        const result = assessGroundedness(kitchenSink, CHAT_DOCS);

        expect(result.penalty).toBe(MAX_GROUNDEDNESS_PENALTY);
        expect(result.suppress).toBe(true);
    });

    it('treats an empty response and empty sources as ungraded rather than throwing', () => {
        expect(assessGroundedness('', CHAT_DOCS).penalty).toBe(0);
        expect(assessGroundedness('', CHAT_DOCS).suppress).toBe(false);

        // No sources means every identifier is unsourced — that is the correct read.
        const noSources = assessGroundedness('Use `.copilotKitInput` here.', []);
        expect(noSources.unsourcedIdentifiers).toEqual(['copilotKitInput']);
    });

    it('tolerates sources with missing title or content', () => {
        const partial = [{ title: '', content: '', score: 0.5 } as SearchResult];
        expect(() => assessGroundedness('Anything at all.', partial)).not.toThrow();
    });

    // The exact response from CopilotKit/CopilotKit#6167, condensed.
    it('would have caught the #6167 response', () => {
        const response = [
            '## Bug Confirmed: Cursor Jump in Expanded Mode',
            'This is a known React controlled input bug.',
            '## Root Cause (Likely)',
            'In expanded mode, the input component probably re-renders on every keystroke.',
            '```css',
            '.copilotKitInputControls { flex-direction: row !important; }',
            '.copilotKitInputControlsExpanded { display: none !important; }',
            '```',
            'This is a real bug worth fixing in the core.',
        ].join('\n');

        const result = assessGroundedness(response, CHAT_DOCS);

        expect(result.suppress).toBe(true);
        expect(result.unverifiedClaims.length).toBeGreaterThanOrEqual(2);
        expect(result.unsourcedIdentifiers).toEqual([
            'copilotKitInputControls',
            'copilotKitInputControlsExpanded',
        ]);
        expect(result.penalty).toBe(MAX_GROUNDEDNESS_PENALTY);
    });
});

/**
 * Corpus organized by RESPONSE SHAPE, not by regex.
 *
 * The unit under test is "given a response that looks like THIS, do we post it?" —
 * so each row names a shape a real answer takes (bare assertion, negated assertion,
 * hedged assertion, markdown bullets, a cited docs URL, a code fence) and pins the
 * publish/withhold decision for it. Rows are shape-complete rather than
 * pattern-complete on purpose: it is the shapes that regress when the matching
 * internals get rewritten.
 */
interface CorpusRow {
    shape: string;
    response: string;
    sources?: SearchResult[];
    /** The decision that matters: does the reporter see this answer? */
    suppress: boolean;
    /** Pinned only where the arithmetic is the point of the row. */
    penalty?: number;
    unsourcedIdentifiers?: string[];
}

const urlSource = (
    sourceUrl: string,
    title = 'Reference',
    content = 'Docs page.',
): SearchResult => ({
    title,
    content,
    score: 0.9,
    sourceUrl,
});

/** A source with no `sourceUrl` at all, so URL text cannot accidentally ground anything. */
const NO_URL_DOCS: SearchResult[] = [
    { title: 'CopilotChat', content: 'CopilotChat renders a chat window.', score: 0.9 },
];

const CORPUS: CorpusRow[] = [
    {
        shape: 'bare assertion of a root cause',
        response: 'Root cause is a re-render on every keystroke.',
        suppress: true,
        penalty: 0.35,
    },
    {
        shape: 'assertion cancelled by a negation BEFORE it',
        response: 'I cannot tell what the root cause is from the docs alone.',
        suppress: false,
        penalty: 0,
    },
    {
        shape: 'assertion cancelled by a negation AFTER it in the same sentence',
        response: 'The root cause is not obvious from the docs.',
        suppress: false,
        penalty: 0,
    },
    {
        // Version numbers must not fragment the sentence, or the negation lands in
        // a different fragment than the claim and a good answer gets withheld.
        shape: 'negated assertion whose sentence contains a version number',
        response: "I can't reproduce on 1.2.3, so the root cause is a mystery.",
        suppress: false,
        penalty: 0,
    },
    {
        shape: 'assertion cancelled by a trailing uncertainty marker',
        response: 'What the root cause is remains unclear.',
        suppress: false,
        penalty: 0,
    },
    {
        // Hedging does not buy the right to assert. The hedge-density penalty is a
        // separate, softer signal; it must not double as an assertion escape hatch.
        shape: 'hedged assertion ("possibly ...")',
        response: 'Possibly the root cause is a re-render.',
        suppress: true,
        penalty: 0.35,
    },
    {
        shape: 'assertion in the sentence AFTER a negated one',
        response: 'I have not reproduced this. Root cause is a re-render.',
        suppress: true,
        penalty: 0.35,
    },
    {
        // A newline ends a thought as firmly as a period does; a negation on the
        // previous bullet says nothing about this one.
        shape: 'negation and assertion on separate markdown bullets',
        response: '- No workaround exists yet\n- Root cause is a re-render on every keystroke',
        suppress: true,
        penalty: 0.35,
    },
    {
        shape: 'cites a docs URL whose path documents the identifier it names',
        response:
            'Wrap your app in `CopilotKitProvider` — see ' +
            'https://docs.copilotkit.ai/reference/components/CopilotKitProvider.',
        sources: [urlSource('https://docs.copilotkit.ai/reference/components/CopilotKitProvider')],
        suppress: false,
        penalty: 0,
        unsourcedIdentifiers: [],
    },
    {
        // The prompt asks for docs links, so the hostname appears in most good
        // answers. It must never register as an identifier of its own.
        shape: 'cites a docs URL absent from the sources',
        response:
            'Full details live at https://docs.copilotkit.ai/reference/components/chat/CopilotChat.',
        sources: NO_URL_DOCS,
        suppress: false,
        penalty: 0,
        unsourcedIdentifiers: [],
    },
    {
        // ...and the reverse: a URL in the RESPONSE cannot launder an invented name.
        shape: 'names an identifier that exists only in a URL the response itself invented',
        response:
            'See https://docs.copilotkit.ai/reference/copilotKitPhantomHook for ' +
            '`copilotKitPhantomHook`.',
        suppress: false,
        penalty: 0.15,
        unsourcedIdentifiers: ['copilotKitPhantomHook'],
    },
    {
        // #6167 put its invented classes inside a ```css fence. Fences are where
        // fabricated identifiers live, so they stay in scope.
        shape: 'invented class names inside a ```css fence',
        response: [
            '```css',
            '.copilotKitGhostA { color: red; }',
            '.copilotKitGhostB { color: blue; }',
            '```',
        ].join('\n'),
        suppress: true,
        unsourcedIdentifiers: ['copilotKitGhostA', 'copilotKitGhostB'],
    },
    {
        shape: 'one invented identifier written in two casings',
        response: 'Override `.copilotKitFoo` and `.CopilotKitFoo` to fix it.',
        suppress: false,
        penalty: 0.15,
        unsourcedIdentifiers: ['copilotKitFoo'],
    },
    {
        // Two claim patterns fire on this one sentence; it is still one claim.
        shape: '"known bug" assertion matching several patterns at once',
        response: 'This is a known bug.',
        suppress: true,
        penalty: 0.35,
    },
    {
        shape: '"no doubt" used as an intensifier, not a negation',
        response: 'There is no doubt this is a real bug.',
        suppress: true,
        penalty: 0.35,
    },
    {
        shape: '"no question about it" used as an intensifier',
        response: 'No question about it, bug confirmed.',
        suppress: true,
        penalty: 0.35,
    },
    {
        shape: 'grounded answer that asserts nothing it cannot support',
        response:
            'You can replace the chat input with the `input` prop on the `CopilotChat` ' +
            'component. That keeps your own state, so you control the cursor.',
        suppress: false,
        penalty: 0,
        unsourcedIdentifiers: [],
    },
];

describe('assessGroundedness response-shape corpus', () => {
    it.each(CORPUS)('$shape', ({ response, sources, suppress, penalty, unsourcedIdentifiers }) => {
        const result = assessGroundedness(response, sources ?? CHAT_DOCS);

        expect(result.suppress).toBe(suppress);
        if (penalty !== undefined) expect(result.penalty).toBeCloseTo(penalty, 5);
        if (unsourcedIdentifiers !== undefined) {
            expect(result.unsourcedIdentifiers).toEqual(unsourcedIdentifiers);
        }
    });

    it('pins the suppression bar to the exported threshold', () => {
        const twoInvented = assessGroundedness(
            'Override `.copilotKitGhostA` and `.copilotKitGhostB`.',
            CHAT_DOCS,
        );
        expect(twoInvented.unsourcedIdentifiers).toHaveLength(SUPPRESS_AT_UNSOURCED_IDENTIFIERS);
        expect(twoInvented.suppress).toBe(true);
    });
});
