/**
 * A high surrogate not followed by a low one, or a low surrogate not preceded by a
 * high one. Either is an unpaired code unit — not a rendering nit but an ill-formed
 * string, which is what slicing at an arbitrary index produces when the index lands in
 * the middle of an astral character such as 👍. Prisma refuses one at the first write,
 * `Message.create`; Postgres would refuse it in text and jsonb too.
 *
 * This restates the production pattern, so a blind spot in one is a blind spot in
 * both. Assert {@link isWellFormed} alongside it.
 */
export const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * True when `text` holds no unpaired surrogate, by the engine's own
 * `String.prototype.isWellFormed` rather than by a pattern. It does not share the
 * production regex, so it catches what that regex and {@link LONE_SURROGATE} would
 * both miss. The TS lib here stops at ES2022, which predates the method, hence the
 * cast; Node 20 and later provide it. U+0000 is well formed, so assert that one
 * separately.
 */
export function isWellFormed(text: string): boolean {
    return (text as unknown as { isWellFormed(): boolean }).isWellFormed();
}
