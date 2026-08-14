export interface TicketCreatedCardOptions {
    title: string;
    /** Whether an AI_RESPONSE job was actually queued for this ticket. */
    aiJobEnqueued: boolean;
}

/**
 * Markdown-active characters in the subset Teams renders inside an Adaptive Card
 * `TextBlock`: emphasis (`*`, `_`), code (backtick), strikethrough (`~`), links
 * and images (`[`, `]`, `(`, `)`, `!`), headings (`#`), block quotes (`>`),
 * bullets (`-`, `+`), table pipes (`|`), and the escape character itself (`\`).
 *
 * Everything here is escapable punctuation in CommonMark, so a backslash-escaped
 * copy renders as the literal character — the reporter sees exactly what they
 * typed, and none of it is interpreted.
 */
const MARKDOWN_ACTIVE = /[\\`*_~[\]()#>|!+-]/g;

/**
 * Neutralize Markdown in reporter-supplied text.
 *
 * A TextBlock always renders its `text` as Markdown in Teams — there is no flag
 * to turn that off — so reporter text placed there is reporter-controlled markup:
 * `[click here](https://phish.example)` in a Teams message became a real link in
 * the bot's own acknowledgment card, borrowing the bot's credibility.
 *
 * Escaping is the fix rather than stripping (which silently mangles legitimate
 * text like `**important**` or a path with underscores) and rather than moving
 * the text into a `RichTextBlock`/`TextRun` (structurally non-Markdown, but it
 * relies on the client honoring that distinction, and if Teams ever rendered
 * Markdown there the injection would be back with nothing catching it).
 */
function escapeMarkdown(text: string): string {
    return text.replace(MARKDOWN_ACTIVE, (char) => `\\${char}`);
}

/**
 * Build an Adaptive Card acknowledging ticket creation.
 *
 * Deliberately carries no ticket displayId. That identifier is internal — it
 * belongs in the dashboard and team slash commands, not in reporter-facing copy.
 *
 * `title` is the reporter's own message text (handlers/message.ts passes
 * truncate(message.content, 200)), so it is Markdown-escaped here rather than
 * rendered verbatim: this builder owns keeping reporter-controlled markup from
 * being interpreted by the Teams renderer. It does NOT sanitize in any other
 * sense — escaping does not hide an identifier, so callers still own keeping
 * internal displayIds out of this field.
 */
export function buildTicketCreatedCard(options: TicketCreatedCardOptions): Record<string, unknown> {
    const { title, aiJobEnqueued } = options;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: "\uD83C\uDFAB We've got your question",
                weight: 'Bolder',
                size: 'Medium',
            },
            {
                type: 'TextBlock',
                text: escapeMarkdown(title),
                wrap: true,
                isSubtle: true,
            },
            {
                type: 'TextBlock',
                text: aiJobEnqueued
                    ? 'Our AI assistant is reviewing your question...'
                    : 'A team member will review your question and follow up.',
                wrap: true,
            },
        ],
    };
}
