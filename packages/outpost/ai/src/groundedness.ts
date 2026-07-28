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
 *
 * Shape of the analysis: **normalize, then split, then judge each sentence.**
 * Earlier revisions matched claim patterns against the whole response and then
 * looked backwards over a fixed character window for a negation. That failed in
 * both directions — it missed trailing negations ("the root cause is not
 * obvious"), let a negation on one markdown bullet cancel an assertion on the
 * next, and could slice `cannot` into a bare `not`. Sentences are the unit a
 * negation actually scopes over, so we cut the text into them first and ask each
 * one, independently, "is this asserted here?".
 */

/** The kind of unsupportable claim a pattern detects. Several patterns can share one. */
type ClaimCategory = 'confirmation' | 'bug-validity' | 'root-cause' | 'fix' | 'reproduction';

/**
 * Claims of verification the bot cannot make: it has no repo, repro, or test run.
 *
 * `category` exists so overlapping wordings are charged once. "This is a known
 * bug" trips both the real-bug pattern and the known-bug pattern; it is still one
 * claim, and billing it twice made a single sentence cost more than two distinct
 * fabrications.
 */
const UNVERIFIED_CLAIM_PATTERNS: Array<{
    pattern: RegExp;
    label: string;
    category: ClaimCategory;
}> = [
    { pattern: /\bbug\s+confirmed\b/i, label: '"bug confirmed"', category: 'confirmation' },
    {
        pattern: /\bconfirmed\s+(?:the\s+|this\s+|a\s+)?bug\b/i,
        label: 'claims the bug is confirmed',
        category: 'confirmation',
    },
    {
        pattern:
            /\bthis\s+is\s+(?:a|an)\s+(?:real|genuine|confirmed|known|legitimate)\s+(?:bug|issue|regression|defect)\b/i,
        label: 'asserts the report is a real bug',
        category: 'bug-validity',
    },
    {
        pattern: /\bknown\s+(?:bug|issue|regression)\b/i,
        label: 'claims a known bug',
        category: 'bug-validity',
    },
    {
        pattern: /\broot\s+cause\s*(?:is\b|:)/i,
        label: 'asserts a root cause',
        category: 'root-cause',
    },
    { pattern: /\bthe\s+fix\s+is\b/i, label: 'asserts the fix', category: 'fix' },
    {
        pattern:
            /\b(?:i|we)\s+(?:reproduced|replicated|verified|tested\s+this|ran\s+the\s+tests?)\b/i,
        label: 'claims to have reproduced or tested',
        category: 'reproduction',
    },
];

/**
 * Words that genuinely reverse a claim inside its own sentence.
 *
 * The patterns above match assertions, but the same words appear in exactly the
 * responses the prompt asks for: "this is **not** a known issue", "I **can't**
 * determine what the root cause is without reproducing it", "I **don't** know what
 * the fix is". Suppression is user-visible (the reporter gets the no-answer reply
 * instead of a real one), so a false positive costs more than a missed one.
 *
 * Hedges — `maybe`, `possibly`, `suspect`, `guess` — are deliberately NOT here.
 * They do not reverse a claim, they only soften its delivery, and "possibly the
 * root cause is X" is precisely the confident-guess shape this gate exists to
 * catch. Hedging is priced separately by the hedge-density penalty below.
 *
 * `no` stays, because "no bug confirmed here" is a real negation — but see
 * INTENSIFIER_PATTERN for the phrases where it means the opposite.
 */
const NEGATOR_PATTERN =
    /\b(?:not|never|cannot|can\s+not|unable|without|unclear|unsure|unconfirmed|unknown|undetermined|no|nor|none|neither)\b|n['’]t\b/i;

/**
 * Phrases where a negator is actually an intensifier: "there is **no doubt** this
 * is a real bug" asserts harder than the plain sentence does. Neutralized before
 * the negator scan so they cannot wave a claim through.
 */
const INTENSIFIER_PATTERN = /\b(?:no|without|beyond)\s+(?:a\s+)?(?:doubt|question)s?\b/gi;
const INTENSIFIER_REPLACEMENT = 'certainly';

/**
 * URLs are replaced with this before any analysis.
 *
 * Two reasons. Identifiers: the prompt actively instructs the bot to cite docs
 * URLs, so `https://docs.copilotkit.ai/...` shows up in most *good* answers, and
 * reading the hostname as a declaration of `.copilotkit` invented a fabrication
 * out of a correct citation. Sentences: a URL is full of `.` and `?`, which would
 * shred one sentence into several. The placeholder carries no `.`, so it is inert
 * on both counts.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"'`]+/gi;
const URL_PLACEHOLDER = ' [url] ';

/**
 * Sentence boundary: terminal punctuation OR a line break. A newline ends a
 * thought as firmly as a period does — markdown answers are mostly bullets, and a
 * negation on one bullet says nothing about the next.
 *
 * A `.` between digits is not a boundary, so `v1.2.3` stays inside its sentence.
 * Splitting a version number would strand the negation ("I can't reproduce this on
 * 1.2.3") in a different fragment from the claim, which suppresses a good answer.
 */
const SENTENCE_BOUNDARY = /(?<!\d)[.!?]+(?!\d)|[\n\r]+/;

/** Hedge markers. A couple is honest; a pile means the answer is guesswork. */
const HEDGE_PATTERNS: RegExp[] = [
    /\blikely\b/gi,
    /\bprobably\b/gi,
    /\bpossibly\b/gi,
    /\bmaybe\b/gi,
    /\bmight\s+be\b/gi,
    /\bmay\s+vary\b/gi,
    /\bshould\s+be\s+able\s+to\b/gi,
    /\bi\s+(?:think|believe|suspect|guess)\b/gi,
    /\bnot\s+sure\b/gi,
];

/**
 * CopilotKit-specific identifiers the response invents out of thin air. Scoped
 * deliberately narrow — CSS classes and backticked tokens that carry our own
 * name — so generic React vocabulary (`useRef`, `useLayoutEffect`) never trips
 * it. `@copilotkit/*` package specifiers are excluded: those are stable public
 * knowledge and routinely correct even when absent from the retrieved page.
 *
 * Fenced code blocks are NOT excluded: #6167 put its two invented class names
 * inside a ```css fence, which is where fabricated identifiers usually live.
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
 *
 * Exported so tests pin the threshold by name instead of hard-coding the number.
 */
export const SUPPRESS_AT_UNSOURCED_IDENTIFIERS = 2;

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

/** Blank out URLs so neither identifier extraction nor sentence splitting sees them. */
function stripUrls(text: string): string {
    return text.replace(URL_PATTERN, URL_PLACEHOLDER);
}

/**
 * Cut text into the units a negation scopes over. Terminal punctuation and line
 * breaks both end a sentence, so a negated markdown bullet cannot reach the next
 * bullet's assertion.
 */
function splitSentences(text: string): string[] {
    return text
        .split(SENTENCE_BOUNDARY)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
}

/**
 * Extract the CopilotKit-specific identifiers a response names.
 *
 * Exported for testing: the extraction rules are the part most likely to drift
 * into false positives, so they're pinned directly.
 *
 * Dedup is case-folded to match the case-insensitive grounding comparison in
 * `assessGroundedness` — otherwise `.copilotKitFoo` plus `.CopilotKitFoo` counts
 * as two fabrications and clears the suppression bar by itself. The first
 * spelling seen is the one reported, so log lines quote the response.
 */
export function extractCopilotKitIdentifiers(response: string): string[] {
    const found = new Map<string, string>();
    const remember = (identifier: string): void => {
        const key = identifier.toLowerCase();
        if (!found.has(key)) found.set(key, identifier);
    };

    const text = stripUrls(response);

    for (const match of text.matchAll(CSS_CLASS_PATTERN)) {
        remember(match[1]);
    }

    for (const match of text.matchAll(BACKTICKED_PATTERN)) {
        const token = match[1].trim();
        // Skip package specifiers and anything that isn't a bare identifier.
        if (token.startsWith('@')) continue;
        if (!/copilotkit/i.test(token)) continue;
        if (!/^[.#]?[A-Za-z_$][\w$-]*$/.test(token)) continue;
        remember(token.replace(/^[.#]/, ''));
    }

    return [...found.values()];
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

    const normalized = stripUrls(response).replace(INTENSIFIER_PATTERN, INTENSIFIER_REPLACEMENT);

    // A claim counts where it is asserted, sentence by sentence: a sentence with no
    // genuine negator anywhere in it — before OR after the matched wording —
    // asserts what it says. One negated mention therefore does not excuse an
    // assertive one elsewhere, and an assertion is not excused by a negation that
    // belongs to a neighbouring sentence.
    //
    // Charging is once per sentence per claim CATEGORY, so overlapping wordings of
    // one accusation ("this is a known bug") cost one claim, not two.
    const unverifiedClaims: string[] = [];
    const seenLabels = new Set<string>();
    let chargeableClaims = 0;

    for (const sentence of splitSentences(normalized)) {
        if (NEGATOR_PATTERN.test(sentence)) continue;

        const categories = new Set<ClaimCategory>();
        for (const { pattern, label, category } of UNVERIFIED_CLAIM_PATTERNS) {
            if (!pattern.test(sentence)) continue;
            categories.add(category);
            if (!seenLabels.has(label)) {
                seenLabels.add(label);
                unverifiedClaims.push(label);
            }
        }
        chargeableClaims += categories.size;
    }

    // Sources are searched as one haystack: an identifier documented on any
    // retrieved page counts as grounded, regardless of which one. `sourceUrl` is
    // part of the haystack — a response naming the very page it was handed
    // (".../reference/components/CopilotKitProvider") is citing, not inventing.
    //
    // Substring, not exact-token: an invented `copilotKitTextarea` counts as
    // grounded if a source mentions `copilotKitTextareaWrapper`. Deliberate — the
    // error goes toward NOT suppressing, and suppression is the user-visible
    // outcome. Tighten to word boundaries only if fabrications start slipping
    // through this way.
    const haystack = sources
        .map((s) => `${s.title ?? ''}\n${s.content ?? ''}\n${s.sourceUrl ?? ''}`)
        .join('\n')
        .toLowerCase();

    const unsourcedIdentifiers = extractCopilotKitIdentifiers(response).filter(
        (id) => !haystack.includes(id.toLowerCase()),
    );

    const hedgeCount = HEDGE_PATTERNS.reduce(
        (count, pattern) => count + (normalized.match(pattern)?.length ?? 0),
        0,
    );
    const excessHedges = Math.max(0, hedgeCount - HEDGE_FREE_ALLOWANCE);

    const penalty = Math.min(
        chargeableClaims * PENALTY_PER_UNVERIFIED_CLAIM +
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
