/**
 * A high surrogate not followed by a low one, or a low surrogate not preceded by a
 * high one. Either is an unpaired code unit — not a rendering nit but an ill-formed
 * string, which is what slicing at an arbitrary index produces when the index lands in
 * the middle of an astral character such as 👍. Postgres refuses one in a jsonb value.
 */
export const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
