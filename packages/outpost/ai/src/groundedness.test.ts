import { describe, it, expect } from 'vitest';
import {
    assessGroundedness,
    extractCopilotKitIdentifiers,
    MAX_GROUNDEDNESS_PENALTY,
    SUPPRESS_AT_UNSOURCED_IDENTIFIERS,
} from './groundedness.js';
import type { GroundednessAssessment } from './groundedness.js';
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

    // The identifier signal is now the ONLY thing that can withhold a response, so
    // a name written as a call, as JSX, or behind a dot has to count the same as the
    // bare spelling — otherwise a fabrication escapes the gate on syntax alone.
    it('picks up a backticked identifier written as a call expression', () => {
        expect(extractCopilotKitIdentifiers('Call `useCopilotKitInternals()` first.')).toEqual([
            'useCopilotKitInternals',
        ]);
        expect(
            extractCopilotKitIdentifiers('Call `useCopilotKitInternals({ debug: true })` first.'),
        ).toEqual(['useCopilotKitInternals']);
    });

    it('picks up a backticked identifier written as JSX', () => {
        expect(extractCopilotKitIdentifiers('Wrap it in `<CopilotKitGhostPanel />`.')).toEqual([
            'CopilotKitGhostPanel',
        ]);
        expect(extractCopilotKitIdentifiers('Close with `</CopilotKitGhostPanel>`.')).toEqual([
            'CopilotKitGhostPanel',
        ]);
        expect(extractCopilotKitIdentifiers('Open with `<CopilotKitGhostPanel>`.')).toEqual([
            'CopilotKitGhostPanel',
        ]);
    });

    it('picks up the CopilotKit-named segments of a dotted member expression', () => {
        expect(
            extractCopilotKitIdentifiers('Read `window.copilotKitInternals` at runtime.'),
        ).toEqual(['copilotKitInternals']);
        expect(extractCopilotKitIdentifiers('Read `CopilotKitApi.copilotKitVersion`.')).toEqual([
            'CopilotKitApi',
            'copilotKitVersion',
        ]);
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

    // A subpath import is still a package specifier, not an API surface claim.
    it('ignores @copilotkit subpath specifiers', () => {
        expect(
            extractCopilotKitIdentifiers('Import from `@copilotkit/react-core/copilotKitGhost`.'),
        ).toEqual([]);
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
        expect(
            extractCopilotKitIdentifiers('See www.copilotkit.ai/reference/chat for docs.'),
        ).toEqual([]);
    });

    // Bare hostnames are how people actually write links in chat, and the host
    // `docs.copilotkit.ai` used to yield the phantom identifier `copilotkit`.
    it('never mines identifiers out of a scheme-less hostname', () => {
        expect(
            extractCopilotKitIdentifiers('See docs.copilotkit.ai/reference/chat for docs.'),
        ).toEqual([]);
        expect(extractCopilotKitIdentifiers('Docs live on copilotkit.ai these days.')).toEqual([]);
        expect(extractCopilotKitIdentifiers('Try the `docs.copilotkit.ai` mirror.')).toEqual([]);
    });

    // Host-stripping is anchored on a real TLD precisely so dotted things that are
    // NOT hostnames survive. Anything swallowed here is an identifier we stop
    // checking against the sources — the gate would go quiet, not loud.
    it('does not mistake a dotted CSS selector chain for a hostname', () => {
        expect(
            extractCopilotKitIdentifiers('Use `.copilotKitInput.copilotKitInputExpanded` instead.'),
        ).toEqual(['copilotKitInput', 'copilotKitInputExpanded']);
    });

    it('does not mistake a version number for a hostname', () => {
        expect(extractCopilotKitIdentifiers('On 1.2.3, override `.copilotKitGhost`.')).toEqual([
            'copilotKitGhost',
        ]);
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

    // The decided contract: `suppress` is driven ONLY by identifiers the sources do
    // not contain. Claim wording is a penalty, never a gate — a misread of English
    // costs 0.35 of confidence, not the reporter's answer.
    it('charges a confirmed-bug claim but does not suppress on it', () => {
        const result = assessGroundedness(
            '## Bug Confirmed: Cursor Jump in Expanded Mode\n\nThanks for the repro steps!',
            CHAT_DOCS,
        );

        expect(result.unverifiedClaims).toContain('"bug confirmed"');
        expect(result.penalty).toBeCloseTo(0.35, 5);
        expect(result.suppress).toBe(false);
    });

    it.each([
        ['Root Cause: React resets the cursor.', 'asserts a root cause'],
        ['This is a real bug worth fixing in the core.', 'asserts the report is a real bug'],
        ['This is a known issue in the chat input.', 'claims a known bug'],
        ['The fix is to save and restore the selection.', 'asserts the fix'],
        ['I reproduced this locally on the latest version.', 'claims to have reproduced or tested'],
        ['We ran the tests and they pass.', 'claims to have reproduced or tested'],
    ])('charges %j without withholding it', (response, expectedLabel) => {
        const result = assessGroundedness(response, CHAT_DOCS);
        expect(result.unverifiedClaims).toContain(expectedLabel);
        expect(result.penalty).toBeGreaterThan(0);
        expect(result.suppress).toBe(false);
    });

    // The reported basis has to equal what was actually billed, or the log line
    // understates the deduction it is supposed to explain.
    describe('reported reasons match what was charged', () => {
        it('charges one claim for a sentence that trips several patterns', () => {
            const result = assessGroundedness('This is a known bug.', CHAT_DOCS);

            expect(result.unverifiedClaims).toHaveLength(1);
            expect(result.penalty).toBeCloseTo(0.35, 5);
            expect(result.reasons).toEqual([
                `unverifiable claims: ${result.unverifiedClaims.join(', ')}`,
            ]);
        });

        it('charges one claim for the same wording repeated across sentences', () => {
            const result = assessGroundedness(
                'Root cause is a re-render. Root cause is a layout thrash.',
                CHAT_DOCS,
            );

            expect(result.unverifiedClaims).toHaveLength(1);
            expect(result.penalty).toBeCloseTo(0.35, 5);
        });

        it('reports every distinct claim it charged, and charges every claim it reports', () => {
            const result = assessGroundedness(
                'Bug confirmed. Root cause is a re-render. The fix is trivial.',
                CHAT_DOCS,
            );

            // Three distinct accusations → three reported labels, and the raw
            // deduction is the count times the rate (clipped by the ceiling here).
            expect(result.unverifiedClaims).toHaveLength(3);
            expect(result.unverifiedClaims.length * 0.35).toBeGreaterThan(MAX_GROUNDEDNESS_PENALTY);
            expect(result.penalty).toBe(MAX_GROUNDEDNESS_PENALTY);
            expect(result.reasons[0]).toBe(
                `unverifiable claims: ${result.unverifiedClaims.join(', ')}`,
            );
            // Suppression is unaffected: three claims, no invented identifier.
            expect(result.suppress).toBe(false);
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

    // The `?? ''` coalesces in the haystack build exist for source rows whose
    // optional fields are genuinely ABSENT — a present-but-empty `title: ''` never
    // reaches the coalesce, so a fixture built that way asserts nothing about them.
    // A partial cast is the only way to reproduce the real shape: a Pathfinder row
    // for a page with no title has no `title` key at all.
    it('tolerates a source whose title, content and sourceUrl are absent entirely', () => {
        const missingFields = [{ score: 0.5 } as unknown as SearchResult];

        let result: GroundednessAssessment | undefined;
        expect(() => {
            result = assessGroundedness('Use `.copilotKitInput` here.', missingFields);
        }).not.toThrow();

        // There is nothing to ground against, so the identifier is correctly reported
        // unsourced — the absent fields contributed no matchable text to the haystack.
        expect(result?.unsourcedIdentifiers).toEqual(['copilotKitInput']);
    });

    // The exact response from CopilotKit/CopilotKit#6167, condensed. It is withheld
    // on its two invented class names alone — the claim wording only adds penalty.
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

        expect(result.unsourcedIdentifiers).toEqual([
            'copilotKitInputControls',
            'copilotKitInputControlsExpanded',
        ]);
        expect(result.unsourcedIdentifiers.length).toBeGreaterThanOrEqual(
            SUPPRESS_AT_UNSOURCED_IDENTIFIERS,
        );
        expect(result.suppress).toBe(true);
        expect(result.unverifiedClaims.length).toBeGreaterThanOrEqual(2);
        expect(result.penalty).toBe(MAX_GROUNDEDNESS_PENALTY);
    });

    // Strip the fabricated class names out of #6167 and the same prose is published
    // with a penalty. That is the decided trade: the claim wording never withholds.
    it('does not withhold the #6167 prose once the invented class names are gone', () => {
        const result = assessGroundedness(
            [
                '## Bug Confirmed: Cursor Jump in Expanded Mode',
                'This is a real bug worth fixing in the core.',
            ].join('\n'),
            CHAT_DOCS,
        );

        expect(result.suppress).toBe(false);
        expect(result.penalty).toBeGreaterThan(0);
    });
});

/**
 * Corpus organized by RESPONSE SHAPE, not by regex.
 *
 * Two outcomes are now independent and both are pinned per row:
 *
 * - `suppress` — does the reporter see this answer? Driven ONLY by identifiers the
 *   sources do not contain, which is checkable against those sources.
 * - `claimCharged` — did the claim-phrase penalty fire? Driven by English wording,
 *   which is fallible, so its only consequence is a lower confidence score.
 *
 * Every negation shape that previously misbehaved has a row here, and they all
 * assert `suppress: false` — no wording, negated or not, can withhold a response.
 */
interface CorpusRow {
    shape: string;
    response: string;
    sources?: SearchResult[];
    /** The decision that matters: does the reporter see this answer? */
    suppress: boolean;
    /** Independent of `suppress`: was the claim-phrase penalty billed? */
    claimCharged: boolean;
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
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    // ---- negation shapes: all publishable, all still charged -------------------
    {
        shape: 'LEADING negation ("I cannot tell what the root cause is")',
        response: 'I cannot tell what the root cause is from the docs alone.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: 'TRAILING negation ("the root cause is not obvious")',
        response: 'The root cause is not obvious from the docs.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: 'INCIDENTAL in-clause negation, real assertion in the next clause',
        response: 'I cannot reproduce it, but the root cause is a re-render.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: 'HEDGE-THEN-ASSERT ("Bug confirmed, though I have no repro steps")',
        response: 'Bug confirmed, though I have no repro steps.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: 'assertion with a trailing "no workaround" clause',
        response: 'This is a known issue with no workaround.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: '"no doubt" — a negator that is really an intensifier',
        response: 'There is no doubt this is a real bug.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        // `no-cache` contains a `no` that is not a word of English negation at all.
        shape: '"no-cache" substring inside an unrelated technical token',
        response: 'Root cause is the `no-cache` header on the docs route.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: 'sentence-crossing negation, assertion in the following sentence',
        response: 'I have not reproduced this. Root cause is a re-render.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        shape: 'negation and assertion on separate markdown bullets',
        response: '- No workaround exists yet\n- Root cause is a re-render on every keystroke',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        // No claim pattern matches at all here — nothing to charge, nothing to gate.
        shape: 'honest non-answer that names no claim wording',
        response: 'I have not reproduced this myself, so engineering should take a look.',
        suppress: false,
        claimCharged: false,
        penalty: 0,
    },
    {
        // Hedging does not buy the right to assert, and it does not excuse it either.
        shape: 'hedged assertion ("possibly ...")',
        response: 'Possibly the root cause is a re-render.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    // ---- identifier shapes: the only thing that withholds ----------------------
    {
        shape: 'cites a docs URL whose path documents the identifier it names',
        response:
            'Wrap your app in `CopilotKitProvider` — see ' +
            'https://docs.copilotkit.ai/reference/components/CopilotKitProvider.',
        sources: [urlSource('https://docs.copilotkit.ai/reference/components/CopilotKitProvider')],
        suppress: false,
        claimCharged: false,
        penalty: 0,
        unsourcedIdentifiers: [],
    },
    {
        // The prompt asks for docs links, so the hostname appears in most good
        // answers. It must never register as an identifier of its own.
        shape: 'cites a docs URL (with scheme) absent from the sources',
        response:
            'Full details live at https://docs.copilotkit.ai/reference/components/chat/CopilotChat.',
        sources: NO_URL_DOCS,
        suppress: false,
        claimCharged: false,
        penalty: 0,
        unsourcedIdentifiers: [],
    },
    {
        // Same link written the way people actually type it. `docs.copilotkit.ai`
        // used to yield the phantom identifier `copilotkit`.
        shape: 'cites a docs URL (SCHEME-LESS host) absent from the sources',
        response: 'Full details live at docs.copilotkit.ai/reference/components/chat/CopilotChat.',
        sources: NO_URL_DOCS,
        suppress: false,
        claimCharged: false,
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
        claimCharged: false,
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
        claimCharged: false,
        unsourcedIdentifiers: ['copilotKitGhostA', 'copilotKitGhostB'],
    },
    {
        shape: 'one invented identifier written in two casings counts once',
        response: 'Override `.copilotKitFoo` and `.CopilotKitFoo` to fix it.',
        suppress: false,
        claimCharged: false,
        penalty: 0.15,
        unsourcedIdentifiers: ['copilotKitFoo'],
    },
    {
        shape: 'two invented identifiers written as a call and as JSX',
        response: 'Call `useCopilotKitGhost()` inside `<CopilotKitGhostPanel />`.',
        suppress: true,
        claimCharged: false,
        unsourcedIdentifiers: ['useCopilotKitGhost', 'CopilotKitGhostPanel'],
    },
    {
        // Two claim patterns fire on this one sentence; it is still one claim.
        shape: '"known bug" assertion matching several patterns at once',
        response: 'This is a known bug.',
        suppress: false,
        claimCharged: true,
        penalty: 0.35,
    },
    {
        // The #6167 shape: unsupportable prose AND invented names. The names gate it.
        shape: 'claim wording plus two invented identifiers',
        response:
            'Bug confirmed. Override `.copilotKitGhostA` and `.copilotKitGhostB` to work around it.',
        suppress: true,
        claimCharged: true,
        // 0.35 claim + 2 × 0.15 identifiers = 0.65, clipped to the ceiling.
        penalty: MAX_GROUNDEDNESS_PENALTY,
        unsourcedIdentifiers: ['copilotKitGhostA', 'copilotKitGhostB'],
    },
    {
        shape: 'grounded answer that asserts nothing it cannot support',
        response:
            'You can replace the chat input with the `input` prop on the `CopilotChat` ' +
            'component. That keeps your own state, so you control the cursor.',
        suppress: false,
        claimCharged: false,
        penalty: 0,
        unsourcedIdentifiers: [],
    },
];

describe('assessGroundedness response-shape corpus', () => {
    it.each(CORPUS)(
        '$shape',
        ({ response, sources, suppress, claimCharged, penalty, unsourcedIdentifiers }) => {
            const result = assessGroundedness(response, sources ?? CHAT_DOCS);

            expect(result.suppress).toBe(suppress);
            expect(result.unverifiedClaims.length > 0).toBe(claimCharged);
            if (penalty !== undefined) expect(result.penalty).toBeCloseTo(penalty, 5);
            if (unsourcedIdentifiers !== undefined) {
                expect(result.unsourcedIdentifiers).toEqual(unsourcedIdentifiers);
            }
        },
    );

    it('never lets claim wording alone withhold a response', () => {
        const withClaimsOnly = CORPUS.filter((row) => row.claimCharged);
        expect(withClaimsOnly.length).toBeGreaterThan(0);

        for (const row of withClaimsOnly) {
            const result = assessGroundedness(row.response, row.sources ?? CHAT_DOCS);
            if (result.unsourcedIdentifiers.length < SUPPRESS_AT_UNSOURCED_IDENTIFIERS) {
                expect(result.suppress).toBe(false);
            }
        }
    });

    it('pins the suppression bar to the exported threshold', () => {
        const oneInvented = assessGroundedness('Override `.copilotKitGhostA`.', CHAT_DOCS);
        expect(oneInvented.unsourcedIdentifiers).toHaveLength(
            SUPPRESS_AT_UNSOURCED_IDENTIFIERS - 1,
        );
        expect(oneInvented.suppress).toBe(false);

        const twoInvented = assessGroundedness(
            'Override `.copilotKitGhostA` and `.copilotKitGhostB`.',
            CHAT_DOCS,
        );
        expect(twoInvented.unsourcedIdentifiers).toHaveLength(SUPPRESS_AT_UNSOURCED_IDENTIFIERS);
        expect(twoInvented.suppress).toBe(true);
    });
});
