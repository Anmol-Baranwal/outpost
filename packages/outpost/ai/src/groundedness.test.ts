import { describe, it, expect } from 'vitest';
import {
    assessGroundedness,
    extractCopilotKitIdentifiers,
    MAX_GROUNDEDNESS_PENALTY,
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

    it('picks up backticked CopilotKit identifiers', () => {
        expect(extractCopilotKitIdentifiers('Call `useCopilotChatInternals()` first.')).toEqual([]);
        expect(extractCopilotKitIdentifiers('Call `useCopilotkitInternals` first.')).toContain(
            'useCopilotkitInternals',
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
