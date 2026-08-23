/**
 * The reply rules from "Fix the Agent's Output", as code.
 *
 * The doc's own success criteria are deliberately mechanical — *"zero invented
 * API names — this one is mechanically checkable, so any occurrence is a bug,
 * not a judgment call"* — and this module is that check. Nothing here calls a
 * model; every rule is a regex or a set lookup over the reply plus the sources
 * it was generated from.
 *
 * ## Two consumers, one rule set
 *
 * These rules are needed twice, and the whole point of putting them here is that
 * the two uses cannot drift apart:
 *
 * 1. **The eval harness** scores a reply after the fact, to answer "did answer
 *    quality move?" across a fixture set of real threads.
 * 2. **The draft linter** (the doc's step 3) runs the same rules *before* the
 *    reply posts, and a failure collapses the draft into the two-sentence
 *    handoff rather than being cleaned up and published.
 *
 * If the linter and the harness ever disagreed about what "invented API name"
 * means, the score would stop predicting the behaviour. So the harness measures
 * exactly what the linter will enforce.
 *
 * ## What is deliberately NOT here
 *
 * Reply-type classification (Answer / Partial / Route / Silent). That taxonomy
 * does not exist in the code yet, and inferring it from the finished text is
 * guesswork — the reply type is chosen from the *evidence*, before writing, so
 * only the pipeline can report it honestly. Until it does, the rules below score
 * observable properties (does it cite, how long is it) rather than pretending to
 * recover the decision.
 */

import { assessGroundedness } from '../groundedness.js';
import type { SearchResult } from '../types.js';

/**
 * Word cap on a reply that cites nothing.
 *
 * The doc's number. A no-answer is currently ~400 words of hedging and should be
 * one line, so the cap is what makes "nothing found -> two sentences, done"
 * checkable rather than aspirational.
 */
export const HANDOFF_WORD_CAP = 60;

/**
 * Phrases the reply may never contain, each traceable to a case in the doc.
 *
 * Anchored tightly on purpose. A rule that fires on ordinary prose is worse than
 * no rule, because a linter failure collapses the draft into a handoff — so a
 * false positive here costs a reporter a correct answer, which is the same
 * failure direction as the groundedness gate withholding one.
 */
const BANNED_PHRASES: Array<{ pattern: RegExp; why: string }> = [
    // Case D's opener, and the doc's "no praise openers" rule.
    { pattern: /\bgreat question\b/i, why: 'praise opener' },
    { pattern: /\bthanks for (?:this|the|your) (?:detailed |thorough |thoughtful )?report\b/i, why: 'praise opener' },
    { pattern: /\bexcellent (?:question|report|catch)\b/i, why: 'praise opener' },
    // Case D's "What I can't do from here" section, and the rule against the
    // agent performing its own humility.
    { pattern: /\bwhat i (?:can'?t|cannot) do\b/i, why: 'self-commentary about its own limits' },
    { pattern: /\bi (?:haven'?t|have not) read the source\b/i, why: 'self-commentary about its own limits' },
    { pattern: /\bi (?:don'?t|do not) have access to\b/i, why: 'self-commentary about its own limits' },
    // Case C: it claimed it could not read the thread. It can.
    {
        pattern: /\bi (?:can'?t|cannot) see (?:other|the other|anyone)[^.]{0,40}\b(?:replies|messages|responses)\b/i,
        why: 'false claim that it cannot see the thread',
    },
    // Case D again: coaching the reporter on how to file better issues.
    {
        pattern: /\bin the future,? please (?:include|provide|attach|add)\b/i,
        why: 'coaching the reporter on how to write issues',
    },
];

/** "Never hedge a name" — a hedge means the name is a guess, so it must go. */
const HEDGED_NAME_PATTERNS: RegExp[] = [
    /\bor the equivalent\b/i,
    /\bor (?:its|the) equivalent\b/i,
    /\bor something similar\b/i,
];

/**
 * The retired package.
 *
 * `@copilotkitnext` was the useAgent-era v2 line and merged into `@copilotkit`
 * v2. Naming it sends a reporter to a package that no longer exists, so the doc
 * makes this an absolute: never mentioned.
 */
const DEAD_PACKAGE = /@copilotkitnext\b/i;

/** A link that constitutes a citation: a docs page or a file in the repo. */
const CITATION_LINK =
    /https?:\/\/(?:[a-z0-9-]+\.)*(?:copilotkit\.ai|github\.com\/CopilotKit|github\.com\/ag-ui-protocol)\/\S+/i;

export const RULES = [
    'grounded-identifiers',
    'source-link-or-handoff',
    'handoff-is-short',
    'no-banned-phrases',
    'no-hedged-names',
    'no-dead-package',
] as const;

export type RuleId = (typeof RULES)[number];

export interface RuleResult {
    rule: RuleId;
    passed: boolean;
    /** Why it failed, naming the offending text. Empty when it passed. */
    detail: string;
}

function countWords(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Run every rule against one reply. Always returns one result per rule, so a
 * report can distinguish "passed" from "not evaluated".
 *
 * `sources` must be the results the reply was actually generated from — the
 * grounding rule is a lookup against them, so passing a different set silently
 * turns the strictest rule into a no-op.
 */
export function checkReply(reply: string, sources: SearchResult[]): RuleResult[] {
    const words = countWords(reply);
    const cites = CITATION_LINK.test(reply);

    // A reply that cites nothing is only acceptable as a short handoff, so the
    // two rules below are the two halves of that single sentence in the doc.
    const isShortEnoughForHandoff = words <= HANDOFF_WORD_CAP;

    const groundedness = assessGroundedness(reply, sources);
    const banned = BANNED_PHRASES.filter(({ pattern }) => pattern.test(reply));
    const hedged = HEDGED_NAME_PATTERNS.filter((pattern) => pattern.test(reply));

    return [
        {
            rule: 'grounded-identifiers',
            passed: groundedness.unsourcedIdentifiers.length === 0,
            detail: groundedness.unsourcedIdentifiers.length
                ? `names not present in any source: ${groundedness.unsourcedIdentifiers.join(', ')}`
                : '',
        },
        {
            rule: 'source-link-or-handoff',
            passed: cites || isShortEnoughForHandoff,
            detail:
                cites || isShortEnoughForHandoff
                    ? ''
                    : `${words} words with no docs or repo link; a reply this long has to cite what it came from`,
        },
        {
            rule: 'handoff-is-short',
            // Only binds when there is nothing to cite. An answer that carries a
            // source has earned its length.
            passed: cites || isShortEnoughForHandoff,
            detail:
                cites || isShortEnoughForHandoff
                    ? ''
                    : `uncited reply is ${words} words, over the ${HANDOFF_WORD_CAP}-word handoff cap`,
        },
        {
            rule: 'no-banned-phrases',
            passed: banned.length === 0,
            detail: banned.map(({ why }) => why).join('; '),
        },
        {
            rule: 'no-hedged-names',
            passed: hedged.length === 0,
            detail: hedged.length ? 'hedges an API name, which means it is guessing' : '',
        },
        {
            rule: 'no-dead-package',
            passed: !DEAD_PACKAGE.test(reply),
            detail: DEAD_PACKAGE.test(reply)
                ? 'mentions @copilotkitnext, which merged into @copilotkit v2'
                : '',
        },
    ];
}
