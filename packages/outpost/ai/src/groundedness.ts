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
 * ## Two signals, two very different consequences
 *
 * The module produces two outcomes and they are deliberately wired to different
 * levers, because they are not equally trustworthy:
 *
 * 1. **`suppress` — the objective signal only.** A response is withheld from the
 *    public thread when it names CopilotKit identifiers that appear in *none* of
 *    the retrieved sources (`unsourcedIdentifiers` ≥
 *    `SUPPRESS_AT_UNSOURCED_IDENTIFIERS`). That is a checkable fact: the name is
 *    either in the sources we handed the model or it is not. No English is parsed
 *    to reach it.
 *
 * 2. **Claim phrases — never withhold; sometimes escalate.** "Bug confirmed",
 *    "root cause is", "I reproduced this" are still detected, still charged
 *    `PENALTY_PER_UNVERIFIED_CLAIM`, and still reported on `unverifiedClaims` and
 *    `reasons`. They never contribute to `suppress`. The subset that asserts *our
 *    own* verification additionally sets `forcesEscalation`, which the pipeline
 *    clamps on so a person reviews the answer — but the answer still posts.
 *
 *    That subset is narrower than "any claim phrase": "this is a known issue,
 *    fixed in 1.9.2" and "the fix is to pass the `input` prop" are ordinary
 *    sentences in a correct docs-grounded answer, so they are priced and left
 *    alone. Escalating on those would page a human several times a day for
 *    English rather than for fabrication. See ESCALATION_FORCING_CATEGORIES.
 *
 * Why: deciding whether a sentence *asserts* a claim or *denies* it is natural
 * language negation, and three successive regex attempts at it failed in three
 * different ways — a backwards character window suppressed "the root cause is not
 * obvious", and the sentence-scoped negator list waved through "This is a known
 * issue with no workaround", "I cannot reproduce it, but the root cause is a
 * re-render", and "Bug confirmed, though I have no repro steps". Negation is not
 * regex-tractable, so it must not gate a user-visible publish/withhold decision.
 * The negation machinery is gone entirely rather than tuned again.
 *
 * What that costs and buys: a misread claim phrase now deducts 0.35 of confidence
 * instead of withholding the reporter's answer. The penalty still pulls the score
 * under the escalation gate, so a human is pulled in and the disclaimer still
 * lands — the consequence of a misread is a lower score, never a lost reply.
 */

/** The kind of unsupportable claim a pattern detects. Several patterns can share one. */
type ClaimCategory =
    | 'confirmation'
    | 'bug-validity'
    | 'known-issue'
    | 'root-cause'
    | 'fix'
    | 'reproduction';

/**
 * The categories that force an escalation, as opposed to only charging a penalty.
 *
 * The split is about WHO is being quoted. These four assert that WE did something
 * we cannot have done — confirmed a bug, established its cause, reproduced it — so
 * a person has to look at the answer.
 *
 * `known-issue` and `fix` are deliberately absent. "This is a known issue, fixed in
 * 1.9.2" and "the fix is to pass the `input` prop" are things a correct,
 * docs-grounded answer says all day, and forcing an escalation on each one would
 * page a human for ordinary English. They still carry the penalty, so a response
 * built out of them still scores lower; it just doesn't wake anyone up.
 */
const ESCALATION_FORCING_CATEGORIES: ReadonlySet<ClaimCategory> = new Set([
    'confirmation',
    'bug-validity',
    'root-cause',
    'reproduction',
]);

/**
 * Claims of verification the bot cannot make: it has no repo, repro, or test run.
 *
 * `category` exists so overlapping wordings are charged once. "This is a known
 * bug" trips both the real-bug pattern and the known-bug pattern; it is still one
 * claim, and billing it twice made a single sentence cost more than two distinct
 * fabrications.
 *
 * Order matters: the FIRST pattern to match a category supplies the label that
 * gets reported, so the more specific wording is listed first ("known issue"
 * should read as "claims a known bug", not as the generic real-bug assertion).
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
        pattern: /\bknown\s+(?:bug|issue|regression)\b/i,
        label: 'claims a known bug',
        category: 'known-issue',
    },
    {
        pattern:
            /\bthis\s+is\s+(?:a|an)\s+(?:real|genuine|confirmed|legitimate)\s+(?:bug|issue|regression|defect)\b/i,
        // `known` is deliberately NOT in the adjective list: "this is a known
        // issue" belongs to the known-issue category, which is priced but does
        // not page anyone. Leaving it here made that sentence match both
        // categories and escalate anyway.
        label: 'asserts the report is a real bug',
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
 * Links are replaced with a placeholder before any analysis.
 *
 * The prompt actively instructs the bot to cite docs URLs, so
 * `https://docs.copilotkit.ai/...` shows up in most *good* answers, and reading
 * the hostname as a declaration of `.copilotkit` invented a fabrication out of a
 * correct citation. Since `suppress` now rides entirely on the identifier signal,
 * a phantom identifier is no longer merely a wrong penalty — two of them withhold
 * a correct answer.
 *
 * Two forms are stripped: fully-qualified links (`https://…`, `www.…`) and the
 * scheme-less host form people actually type in chat and issue comments
 * (`docs.copilotkit.ai/reference`). The host form is anchored on a known TLD so a
 * version number (`1.2.3`) or a CSS selector (`.copilotKitInput`) is never
 * mistaken for a hostname — stripping those would hide real identifiers.
 *
 * The placeholder carries no `.`, so nothing downstream can mine it.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"'`]+/gi;
const BARE_HOST_PATTERN =
    /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:ai|app|co|com|dev|io|net|org|sh)\b(?:\/[^\s<>()[\]{}"'`]*)?/gi;
const URL_PLACEHOLDER = ' [url] ';

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
 * to CSS classes and backticked tokens whose NAME SHAPE marks them as ours (see
 * `COPILOTKIT_IDENTIFIER_SHAPES`), so generic React vocabulary (`useRef`,
 * `useLayoutEffect`) never trips it. `@copilotkit/*` package specifiers are
 * excluded: those are stable public knowledge and routinely correct even when
 * absent from the retrieved page.
 *
 * Fenced code blocks are NOT excluded: #6167 put its two invented class names
 * inside a ```css fence, which is where fabricated identifiers usually live.
 */
// Case-insensitive, and matched on `copilot` rather than `copilotkit`: a
// selector-prefixed name starting with our product word is ours whatever
// follows, so an invented `.copilot-chat` is caught alongside `.copilotKitInput`.
// The leading `.` is what makes this safe to widen — it marks a selector, not
// the English word.
const CSS_CLASS_PATTERN = /\.(copilot[A-Za-z0-9_-]*)/gi;
const BACKTICKED_PATTERN = /`([^`\n]{1,80})`/g;

/**
 * What counts as "a CopilotKit identifier".
 *
 * The signal these feed is the ONLY thing that can withhold a response (#143
 * made claim wording penalty-only), so this list is the whole gate. It used to
 * be the literal substring `copilotkit`, which exempted every name the model is
 * actually likely to invent — `useCopilotAction`, `CopilotChat`,
 * `CopilotSidebar`, `CopilotTextarea` are all neighbours of real API names and
 * none of them contain the product name in full (#147).
 *
 * Answering that with a looser `/copilot/i` would have been worse than the bug:
 * a false positive here withholds a CORRECT answer from a real reporter, and
 * `copilot` on its own is an English word we and our users both use in prose.
 * So this is a list of SHAPES rather than a substring test — each one is a form
 * a name can only plausibly take if it is naming our API surface.
 */
const COPILOTKIT_IDENTIFIER_SHAPES: RegExp[] = [
    // 1. Carries the product name outright: `CopilotKit`, `copilotKitInput`,
    //    `CopilotKitProvider`, `copilotkit-popup`. The original rule, kept
    //    because it is the one that needs no casing convention to hold.
    /copilotkit/i,
    // 2. PascalCase component: `CopilotChat`, `CopilotSidebar`, `CopilotPopup`,
    //    `CopilotTextarea`, `CopilotRuntime`. The required second capital is what
    //    keeps English out — bare `Copilot`, `copilots` and `copiloting` are
    //    prose about the product, not claims about an API that exists.
    /^Copilot[A-Z0-9_]/,
    // 3. Hook: `useCopilotAction`, `useCopilotReadable`, `useCopilotChat`. Same
    //    required capital, same reason.
    /^useCopilot[A-Z0-9_]/,
];

/**
 * True when a name is shaped like part of CopilotKit's API surface.
 *
 * Deliberately NOT covered: the `CoAgent` / `useCoAgent` family. Those are ours
 * too, but no shape rule separates them from generic React vocabulary without
 * reaching for a hand-maintained name list — and a stale allowlist fails in the
 * direction that withholds correct answers. They stay outside the gate until
 * something better than a substring is available for them.
 */
function isCopilotKitIdentifier(segment: string): boolean {
    return COPILOTKIT_IDENTIFIER_SHAPES.some((shape) => shape.test(segment));
}

/** `<Foo>`, `<Foo />`, `</Foo>` — JSX is how a component name is usually written. */
const JSX_WRAPPER = /^<\/?\s*([A-Za-z_$][\w$.-]*)\s*\/?>$/;
/** `foo()`, `foo({ debug: true })` — a call is still a claim about an API surface. */
const CALL_EXPRESSION = /^([^()]*?)\(\s*[^()]*\)$/;
/** A bare identifier, optionally selector-prefixed and optionally dotted. */
const IDENTIFIER_PATH = /^[.#]?[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/;

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
 * This is the ONLY input to `suppress`, so the extraction rules below carry the
 * whole gate. Exported so tests pin the threshold by name instead of hard-coding
 * the number.
 */
export const SUPPRESS_AT_UNSOURCED_IDENTIFIERS = 2;

export interface GroundednessAssessment {
    /** Amount to deduct from the confidence score (0 – MAX_GROUNDEDNESS_PENALTY). */
    penalty: number;
    /**
     * Verification claims the bot is not entitled to make. One entry per claim
     * actually charged, so the reported basis equals the deduction. Penalty-only:
     * these never set `suppress`.
     */
    unverifiedClaims: string[];
    /** CopilotKit identifiers named in the response but absent from every source. */
    unsourcedIdentifiers: string[];
    /** Total hedge markers found. */
    hedgeCount: number;
    /**
     * True when the response names identifiers no retrieved source contains — the
     * one signal here that is verifiable against those sources. The caller is
     * expected to withhold it from the public thread and escalate to a human
     * instead; a lowered score alone does not stop a post.
     */
    suppress: boolean;
    /**
     * True when at least one charged claim asserts that WE verified something —
     * confirmed a bug, established a root cause, reproduced it. The caller clamps
     * below the escalation gate on this so a person reviews the answer.
     *
     * Distinct from `unverifiedClaims.length > 0`, which also counts claims a
     * correct docs-grounded answer legitimately makes ("known issue", "the fix
     * is"). Those are priced but do not page anyone — see
     * ESCALATION_FORCING_CATEGORIES.
     */
    forcesEscalation: boolean;
    /** Human-readable reasons, for logs and the dashboard. */
    reasons: string[];
}

/** Blank out links so identifier extraction never reads a hostname as an API name. */
function stripUrls(text: string): string {
    return text.replace(URL_PATTERN, URL_PLACEHOLDER).replace(BARE_HOST_PATTERN, URL_PLACEHOLDER);
}

/**
 * Reduce a backticked token to the CopilotKit-named identifiers it declares.
 *
 * Widened past the bare-name guard it started with, because the identifier signal
 * is now the whole gate: `useCopilotAction()`, `<CopilotChat />` and
 * `window.copilotKitFoo` are the same claim as `copilotKitFoo`, and letting a
 * fabrication through on syntax alone would defeat the check. Package specifiers
 * (`@copilotkit/react-core`) stay excluded — they are stable public knowledge, not
 * a claim about the retrieved page.
 *
 * Which names count is `isCopilotKitIdentifier`; this function only handles the
 * syntax a name can be written in.
 *
 * Anything that isn't identifier-shaped after unwrapping (prose, a fenced snippet,
 * a path) yields nothing.
 */
function identifierSegments(rawToken: string): string[] {
    let token = rawToken.trim();
    if (!token) return [];
    // Package specifier, including subpath imports.
    if (token.startsWith('@')) return [];
    // No early substring guard here any more. The shape rules are anchored, so
    // they cannot be applied to a still-wrapped token (`<CopilotChat />`), and
    // the per-segment filter at the bottom runs after unwrapping and decides the
    // same question correctly. `IDENTIFIER_PATH` already rejects prose, so
    // dropping the pre-filter costs a little work on non-identifier tokens and
    // buys the gate every name it used to exempt.

    const jsx = JSX_WRAPPER.exec(token);
    if (jsx) token = jsx[1];

    const call = CALL_EXPRESSION.exec(token);
    if (call) token = call[1].trim();

    if (!IDENTIFIER_PATH.test(token)) return [];

    // A dotted form names a member; report the segments that carry our name so the
    // grounding lookup compares something a source could plausibly contain.
    return token.split('.').filter((segment) => segment && isCopilotKitIdentifier(segment));
}

/**
 * Extract the CopilotKit-specific identifiers a response names.
 *
 * Exported for testing: the extraction rules are the part most likely to drift
 * into false positives, so they're pinned directly.
 *
 * Results are in the order the names appear in the response, so logs read like the
 * answer. Dedup is case-folded to match the case-insensitive grounding comparison
 * in `assessGroundedness` — otherwise `.copilotKitFoo` plus `.CopilotKitFoo` counts
 * as two fabrications and clears the suppression bar by itself. The first spelling
 * seen is the one reported.
 */
export function extractCopilotKitIdentifiers(response: string): string[] {
    const text = stripUrls(response);
    const hits: Array<{ at: number; name: string }> = [];

    for (const match of text.matchAll(CSS_CLASS_PATTERN)) {
        hits.push({ at: match.index ?? 0, name: match[1] });
    }

    for (const match of text.matchAll(BACKTICKED_PATTERN)) {
        const token = match[1];
        const tokenStart = (match.index ?? 0) + 1;
        for (const segment of identifierSegments(token)) {
            hits.push({ at: tokenStart + token.indexOf(segment), name: segment });
        }
    }

    hits.sort((a, b) => a.at - b.at);

    const found = new Map<string, string>();
    for (const { name } of hits) {
        const key = name.toLowerCase();
        if (!found.has(key)) found.set(key, name);
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
        forcesEscalation: false,
        reasons: [],
    };

    if (!response) return empty;

    const normalized = stripUrls(response);

    // One charge per claim CATEGORY over the whole response, and the reported
    // labels ARE the charged ones — `unverifiedClaims.length` is the multiplier, so
    // the log line can never understate the deduction it explains. Overlapping
    // wordings of one accusation ("this is a known bug") cost one claim, not two.
    //
    // No negation analysis: the response is scanned as written. A denial that
    // happens to contain the wording is charged too, and that is the accepted
    // trade — see the module comment. The consequence is a lower score, never a
    // withheld reply.
    const unverifiedClaims: string[] = [];
    const chargedCategories = new Set<ClaimCategory>();
    const escalationForcing: string[] = [];

    for (const { pattern, label, category } of UNVERIFIED_CLAIM_PATTERNS) {
        if (chargedCategories.has(category)) continue;
        if (!pattern.test(normalized)) continue;
        chargedCategories.add(category);
        unverifiedClaims.push(label);
        if (ESCALATION_FORCING_CATEGORIES.has(category)) escalationForcing.push(label);
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
        unverifiedClaims.length * PENALTY_PER_UNVERIFIED_CLAIM +
            unsourcedIdentifiers.length * PENALTY_PER_UNSOURCED_IDENTIFIER +
            excessHedges * PENALTY_PER_EXCESS_HEDGE,
        MAX_GROUNDEDNESS_PENALTY,
    );

    // Objective signal only. Claim wording is priced above and stops there.
    const suppress = unsourcedIdentifiers.length >= SUPPRESS_AT_UNSOURCED_IDENTIFIERS;
    const forcesEscalation = escalationForcing.length > 0;

    const reasons: string[] = [];
    if (unverifiedClaims.length) {
        reasons.push(`unverifiable claims: ${unverifiedClaims.join(', ')}`);
    }
    if (forcesEscalation) {
        reasons.push(`asserts own verification: ${escalationForcing.join(', ')}`);
    }
    if (unsourcedIdentifiers.length) {
        reasons.push(`identifiers absent from sources: ${unsourcedIdentifiers.join(', ')}`);
    }
    if (excessHedges > 0) {
        reasons.push(`${hedgeCount} hedge markers`);
    }

    return {
        penalty,
        unverifiedClaims,
        unsourcedIdentifiers,
        hedgeCount,
        suppress,
        forcesEscalation,
        reasons,
    };
}
