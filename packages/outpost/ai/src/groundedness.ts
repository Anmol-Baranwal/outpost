import type { SearchResult } from './types.js';

/**
 * Deterministic groundedness check over a generated response.
 *
 * The confidence signals we had before this module both ignored the *content* of
 * the answer: `ResponseGenerator.assessConfidence` scored docs relevance and
 * source count only, and the LLM scorer's rubric rewarded specificity ("cites
 * specific features, APIs, or code patterns") without asking whether those
 * citations were real. A confident fabrication therefore scored exactly as high
 * as a cited answer — see CopilotKit/CopilotKit#6167, where the bot confirmed a
 * bug it never reproduced and invented two CSS class names to explain it.
 *
 * This runs no model call. Everything here is a regex over the response plus a
 * substring lookup against the sources the response was generated from, so it is
 * cheap, deterministic, and unit-testable — the prompt rules in generator.ts are
 * the request, this is the enforcement.
 */

/** Claims of verification the bot cannot make: it has no repo, repro, or test run. */
const UNVERIFIED_CLAIM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bbug\s+confirmed\b/i, label: '"bug confirmed"' },
    { pattern: /\bconfirmed\s+(?:the\s+|this\s+|a\s+)?bug\b/i, label: 'claims the bug is confirmed' },
    {
        pattern: /\bthis\s+is\s+(?:a|an)\s+(?:real|genuine|confirmed|known|legitimate)\s+(?:bug|issue|regression|defect)\b/i,
        label: 'asserts the report is a real bug',
    },
    { pattern: /\bknown\s+(?:bug|issue|regression)\b/i, label: 'claims a known bug' },
    { pattern: /\broot\s+cause\s*(?:is\b|:)/i, label: 'asserts a root cause' },
    { pattern: /\bthe\s+fix\s+is\b/i, label: 'asserts the fix' },
    {
        pattern: /\b(?:i|we)\s+(?:reproduced|replicated|verified|tested\s+this|ran\s+the\s+tests?)\b/i,
        label: 'claims to have reproduced or tested',
    },
];

/**
 * Negation and uncertainty markers that flip a claim pattern's meaning.
 *
 * The patterns above match assertions, but the same words appear in exactly the
 * responses the prompt asks for: "this is **not** a known issue", "I **can't**
 * determine what the root cause is without reproducing it", "I **don't** know what
 * the fix is". Suppression is user-visible (the reporter gets the no-answer reply
 * instead of a real one), so a false positive costs more than a missed one.
 *
 * Anchored with `[^.!?]{0,N}$` so the marker has to sit in the SAME sentence as the
 * claim — "That's confirmed. I have not tested it." must still count as a claim.
 */
const NEGATION_LOOKBEHIND =
    /\b(?:not|never|cannot|can't|can not|won't|couldn't|don't|doesn't|didn't|unable|without|unclear|unsure|unconfirmed|no|nor|if|whether|maybe|possibly|suspect|guess)\b[^.!?]{0,80}$/i;

/** How far back to look for a negation marker preceding a claim. */
const NEGATION_WINDOW = 100;

/**
 * True when a claim match at `index` is negated or hedged by preceding text in the
 * same sentence.
 */
function isNegated(response: string, index: number): boolean {
    const before = response.slice(Math.max(0, index - NEGATION_WINDOW), index);
    return NEGATION_LOOKBEHIND.test(before);
}

/** Hedge markers. A couple is honest; a pile means the answer is guesswork. */
const HEDGE_PATTERNS: RegExp[] = [
    /\blikely\b/gi,
    /\bprobably\b/gi,
    /\bmight\s+be\b/gi,
    /\bmay\s+vary\b/gi,
    /\bshould\s+be\s+able\s+to\b/gi,
    /\bi\s+(?:think|believe|suspect)\b/gi,
    /\bnot\s+sure\b/gi,
];

/**
 * CopilotKit-specific identifiers the response invents out of thin air. Scoped
 * deliberately narrow — CSS classes and backticked tokens that carry our own
 * name — so generic React vocabulary (`useRef`, `useLayoutEffect`) never trips
 * it. `@copilotkit/*` package specifiers are excluded: those are stable public
 * knowledge and routinely correct even when absent from the retrieved page.
 */
// Case-insensitive: an invented `.copilotkit-input` or `.CopilotKitInput` is just
// as ungrounded as `.copilotKitInput`, and the `/copilotkit/i` guard below already
// treats the name case-insensitively.
const CSS_CLASS_PATTERN = /\.(copilotkit[A-Za-z0-9_-]*)/gi;
const BACKTICKED_PATTERN = /`([^`\n]{1,80})`/g;

/** Hedges allowed before the density penalty starts. */
const HEDGE_FREE_ALLOWANCE = 2;

const PENALTY_PER_UNVERIFIED_CLAIM = 0.35;
const PENALTY_PER_UNSOURCED_IDENTIFIER = 0.15;
const PENALTY_PER_EXCESS_HEDGE = 0.03;

/** Ceiling on the total deduction, so groundedness can't alone zero out a score. */
export const MAX_GROUNDEDNESS_PENALTY = 0.6;

/**
 * Number of invented identifiers that, on its own, makes a response unsafe to
 * publish. One could be a formatting artifact; two is a pattern of fabrication
 * (#6167 shipped exactly two).
 */
const SUPPRESS_AT_UNSOURCED_IDENTIFIERS = 2;

export interface GroundednessAssessment {
    /** Amount to deduct from the confidence score (0 – MAX_GROUNDEDNESS_PENALTY). */
    penalty: number;
    /** Verification claims the bot is not entitled to make. */
    unverifiedClaims: string[];
    /** CopilotKit identifiers named in the response but absent from every source. */
    unsourcedIdentifiers: string[];
    /** Total hedge markers found. */
    hedgeCount: number;
    /**
     * True when the response makes a claim we cannot stand behind. The caller is
     * expected to withhold it from the public thread and escalate to a human
     * instead — a lowered score alone does not stop a post.
     */
    suppress: boolean;
    /** Human-readable reasons, for logs and the dashboard. */
    reasons: string[];
}

/**
 * Extract the CopilotKit-specific identifiers a response names.
 *
 * Exported for testing: the extraction rules are the part most likely to drift
 * into false positives, so they're pinned directly.
 */
export function extractCopilotKitIdentifiers(response: string): string[] {
    const found = new Set<string>();

    for (const match of response.matchAll(CSS_CLASS_PATTERN)) {
        found.add(match[1]);
    }

    for (const match of response.matchAll(BACKTICKED_PATTERN)) {
        const token = match[1].trim();
        // Skip package specifiers and anything that isn't a bare identifier.
        if (token.startsWith('@')) continue;
        if (!/copilotkit/i.test(token)) continue;
        if (!/^[.#]?[A-Za-z_$][\w$-]*$/.test(token)) continue;
        found.add(token.replace(/^[.#]/, ''));
    }

    return [...found];
}

/**
 * Assess how well a generated response is supported by the sources it was
 * generated from. Never throws — a malformed response yields a zero penalty
 * rather than breaking the pipeline.
 */
export function assessGroundedness(
    response: string,
    sources: SearchResult[],
): GroundednessAssessment {
    const empty: GroundednessAssessment = {
        penalty: 0,
        unverifiedClaims: [],
        unsourcedIdentifiers: [],
        hedgeCount: 0,
        suppress: false,
        reasons: [],
    };

    if (!response) return empty;

    // A pattern counts only where it is actually asserted. Every occurrence is
    // checked, so one negated mention doesn't excuse an assertive one elsewhere.
    const unverifiedClaims = UNVERIFIED_CLAIM_PATTERNS.filter(({ pattern }) => {
        const global = new RegExp(pattern.source, 'gi');
        return [...response.matchAll(global)].some((m) => !isNegated(response, m.index ?? 0));
    }).map(({ label }) => label);

    // Sources are searched as one haystack: an identifier documented on any
    // retrieved page counts as grounded, regardless of which one.
    //
    // Substring, not exact-token: an invented `copilotKitTextarea` counts as
    // grounded if a source mentions `copilotKitTextareaWrapper`. Deliberate — the
    // error goes toward NOT suppressing, and suppression is the user-visible
    // outcome. Tighten to word boundaries only if fabrications start slipping
    // through this way.
    const haystack = sources
        .map((s) => `${s.title ?? ''}\n${s.content ?? ''}`)
        .join('\n')
        .toLowerCase();

    const unsourcedIdentifiers = extractCopilotKitIdentifiers(response).filter(
        (id) => !haystack.includes(id.toLowerCase()),
    );

    const hedgeCount = HEDGE_PATTERNS.reduce(
        (count, pattern) => count + (response.match(pattern)?.length ?? 0),
        0,
    );
    const excessHedges = Math.max(0, hedgeCount - HEDGE_FREE_ALLOWANCE);

    const penalty = Math.min(
        unverifiedClaims.length * PENALTY_PER_UNVERIFIED_CLAIM +
            unsourcedIdentifiers.length * PENALTY_PER_UNSOURCED_IDENTIFIER +
            excessHedges * PENALTY_PER_EXCESS_HEDGE,
        MAX_GROUNDEDNESS_PENALTY,
    );

    const suppress =
        unverifiedClaims.length > 0 ||
        unsourcedIdentifiers.length >= SUPPRESS_AT_UNSOURCED_IDENTIFIERS;

    const reasons: string[] = [];
    if (unverifiedClaims.length) {
        reasons.push(`unverifiable claims: ${unverifiedClaims.join(', ')}`);
    }
    if (unsourcedIdentifiers.length) {
        reasons.push(`identifiers absent from sources: ${unsourcedIdentifiers.join(', ')}`);
    }
    if (excessHedges > 0) {
        reasons.push(`${hedgeCount} hedge markers`);
    }

    return { penalty, unverifiedClaims, unsourcedIdentifiers, hedgeCount, suppress, reasons };
}
