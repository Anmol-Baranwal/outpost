/**
 * Extract the ticket display ID from the MailboxHash (plus-addressing).
 * e.g. "TKT-AB12CD34" from ticket+TKT-AB12CD34@support.example.com
 */
export function extractTicketId(mailboxHash: string | undefined): string | null {
    if (!mailboxHash) return null;
    const match = mailboxHash.match(/^(TKT-[A-Z0-9]+)$/i);
    return match ? match[1].toUpperCase() : null;
}

/** Extract the sender's email address from the From header. */
export function extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from.trim();
}

/** Extract the sender's display name from the From header. */
export function extractName(from: string, fromName?: string): string {
    if (fromName) return fromName;
    const match = from.match(/^([^<]+)</);
    return match ? match[1].trim() : from.trim();
}

/** RFC 5322 threading headers that mark a message as a reply. */
const REPLY_HEADERS = ['in-reply-to', 'references'] as const;

/** Read the FIRST value of a header, case-insensitively (SMTP header names are not case-sensitive). */
export function getHeaderValue(
    headers: Array<{ Name: string; Value: string }> | undefined,
    name: string,
): string | undefined {
    if (!headers?.length) return undefined;
    const wanted = name.toLowerCase();
    return headers.find((h) => h?.Name?.toLowerCase() === wanted)?.Value;
}

/**
 * Read EVERY value of a header, case-insensitively, in the order Postmark
 * listed them.
 *
 * `References` is legitimately repeated across multiple header lines by some
 * mail clients — RFC 5322 folding is one way to continue a long chain, but a
 * split into several `References:` lines is what actually shows up in the wild,
 * and Postmark surfaces each line as its own `Headers[]` entry. Reading only the
 * first entry drops chain segments, so a reply whose matching Message-ID sits in
 * a later segment never resolves and opens a brand-new ticket instead of
 * threading.
 */
export function getHeaderValues(
    headers: Array<{ Name: string; Value: string }> | undefined,
    name: string,
): string[] {
    if (!headers?.length) return [];
    const wanted = name.toLowerCase();
    const values: string[] = [];
    for (const header of headers) {
        if (header?.Name?.toLowerCase() === wanted && typeof header.Value === 'string') {
            values.push(header.Value);
        }
    }
    return values;
}

/**
 * Normalize a Message-ID for comparison.
 *
 * Header values are angle-bracketed and may be folded across lines
 * (`\r\n\t<id>`), while Postmark's own `MessageID` field is bare. Both forms
 * have to compare equal or a reply silently looks like a brand-new email.
 */
export function normalizeMessageId(raw: string | undefined | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * True when the payload carries an RFC 5322 threading header with content —
 * i.e. this inbound email is a reply, whether or not we can resolve it to a
 * ticket. Plus-addressing (`MailboxHash`) is checked separately and takes
 * precedence; this is the fallback for the common case where the customer's
 * mail client replies to a plain From address.
 */
export function hasReplyHeaders(
    headers: Array<{ Name: string; Value: string }> | undefined,
): boolean {
    return REPLY_HEADERS.some((name) =>
        getHeaderValues(headers, name).some((value) => value.trim().length > 0),
    );
}

/**
 * Cap on candidate Message-IDs taken from one payload.
 *
 * The header value is sender-supplied and unbounded, and each candidate widens
 * an `IN (…)` lookup that now returns every match with its participant set.
 * Truncating is safe for resolution: `In-Reply-To` is collected first and
 * `References` runs oldest → newest, so the thread root — the ID stored as
 * `Ticket.sourceId` — is always near the front. Real chains are far under this;
 * RFC 5322 §3.6.4 already expects clients to trim long ones.
 */
export const MAX_REPLY_MESSAGE_IDS = 50;

/**
 * Collect every candidate Message-ID a reply points at, normalized and deduped.
 *
 * `In-Reply-To` alone is not enough: when a customer replies to a message
 * Outpost sent, it names an outbound Message-ID we never persisted. `References`
 * accumulates the whole thread chain, so it still contains the customer's own
 * opening Message-ID — the value stored as `Ticket.sourceId`.
 *
 * Order is In-Reply-To first, then the References chain as sent (oldest →
 * newest). Callers match the whole set at once, so order is informational except
 * where `MAX_REPLY_MESSAGE_IDS` truncates.
 *
 * Every occurrence of each header is read, not just the first: clients that
 * split a long `References` chain across several header lines would otherwise
 * lose every segment after the first, and with it the thread root.
 * `MAX_REPLY_MESSAGE_IDS` still bounds the total across all occurrences, so the
 * wider input cannot widen the downstream `IN (…)` lookup.
 */
export function extractReplyMessageIds(
    headers: Array<{ Name: string; Value: string }> | undefined,
): string[] {
    const ids: string[] = [];
    for (const name of REPLY_HEADERS) {
        for (const value of getHeaderValues(headers, name)) {
            if (!value) continue;
            // References is whitespace-separated; tolerate comma-separated clients.
            for (const token of value.split(/[\s,]+/)) {
                const id = normalizeMessageId(token);
                if (id && !ids.includes(id)) ids.push(id);
                if (ids.length >= MAX_REPLY_MESSAGE_IDS) return ids;
            }
        }
    }
    return ids;
}

/**
 * Parse a stored participant label down to a comparable email address.
 *
 * `Message.author` holds free-form labels from every channel — `"Alice Smith
 * <alice@example.com>"` from this webhook, but also `"Outpost AI"`, `"System"`,
 * `"slack:U123"` and `"octocat (583231)"`. Only values that actually parse to an
 * address may be treated as a participant, otherwise a sender literally named
 * `System` would inherit every ticket the escalation handler ever touched.
 */
export function normalizeParticipantEmail(raw: string | undefined | null): string | null {
    if (!raw) return null;
    const candidate = extractEmail(raw).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Domain part of an already-normalized address. */
export function emailDomain(email: string | null | undefined): string | null {
    if (!email) return null;
    const at = email.lastIndexOf('@');
    return at > 0 && at < email.length - 1 ? email.slice(at + 1) : null;
}

/** The participant-bearing fields the header reply path reads off a ticket. */
export interface TicketParticipants {
    user?: { email: string | null } | null;
    account?: { domain: string | null } | null;
    messages?: Array<{ author: string | null } | null> | null;
}

/**
 * True when `senderEmail` is already part of this ticket's conversation.
 *
 * `In-Reply-To` / `References` are attacker-controlled: a Message-ID is *known*
 * to every thread participant (including anyone ever CC'd), so header matching
 * alone lets an outsider append to — and reopen — someone else's ticket. This is
 * the authorization half of that lookup.
 *
 * A participant is:
 *   1. the ticket's linked `user.email`;
 *   2. any address parsed out of an existing `Message.author` on the ticket —
 *      this is the load-bearing one, since it covers whoever opened the thread
 *      plus anyone (customer or team member) who has already replied by email;
 *   3. anybody at the ticket's `account.domain`, so a colleague or a second
 *      address on the same thread is not locked out.
 *
 * Deliberately NOT a participant: someone sharing the *derived* domain of
 * `user.email` or of a message author. Inferring the domain from a participant's
 * address would make every `gmail.com` sender a participant on any ticket opened
 * from a `gmail.com` address — most consumer tickets — which reintroduces the
 * hole. `Account.domain` is company data a human deliberately set on the CRM
 * record, so it cannot silently widen to a public mail provider.
 *
 * Aliases that match none of the three are not dropped: the caller falls through
 * to the orphaned-reply path, which files the message as its own ticket for a
 * human and never spends an AI response on it.
 */
export function isTicketParticipant(
    senderEmail: string | undefined | null,
    ticket: TicketParticipants,
): boolean {
    const sender = normalizeParticipantEmail(senderEmail);
    if (!sender) return false;

    if (normalizeParticipantEmail(ticket.user?.email) === sender) return true;

    for (const message of ticket.messages ?? []) {
        if (normalizeParticipantEmail(message?.author) === sender) return true;
    }

    const accountDomain = ticket.account?.domain?.trim().toLowerCase().replace(/^@/, '');
    if (accountDomain && emailDomain(sender) === accountDomain) return true;

    return false;
}

/**
 * The named HTML entities worth decoding out of an email body.
 *
 * Deliberately a short list rather than the full HTML5 named-reference table:
 * these are what real mail clients emit, and anything unrecognized is left as
 * written rather than mangled. Numeric references (`&#39;`, `&#x2019;`) are
 * handled generically below, which covers most of the long tail.
 */
const HTML_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ensp: ' ',
    emsp: ' ',
    thinsp: ' ',
    shy: '',
    zwnj: '',
    zwj: '',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    sbquo: '‚',
    ldquo: '“',
    rdquo: '”',
    bdquo: '„',
    laquo: '«',
    raquo: '»',
    bull: '•',
    middot: '·',
    copy: '©',
    reg: '®',
    trade: '™',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
    deg: '°',
    plusmn: '±',
    times: '×',
    divide: '÷',
    frac12: '½',
    sect: '§',
    para: '¶',
    dagger: '†',
    permil: '‰',
    prime: '′',
    Prime: '″',
    larr: '←',
    rarr: '→',
    harr: '↔',
    hArr: '⇔',
    ne: '≠',
    le: '≤',
    ge: '≥',
};

/** Decode the HTML entities a mail client is likely to emit; leave the rest verbatim. */
export function decodeHtmlEntities(input: string): string {
    return input.replace(
        /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
        (match, entity: string) => {
            if (entity.startsWith('#')) {
                const hex = entity[1] === 'x' || entity[1] === 'X';
                const code = Number.parseInt(
                    hex ? entity.slice(2) : entity.slice(1),
                    hex ? 16 : 10,
                );
                if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
                try {
                    return String.fromCodePoint(code);
                } catch {
                    return match;
                }
            }
            return HTML_ENTITIES[entity] ?? HTML_ENTITIES[entity.toLowerCase()] ?? match;
        },
    );
}

/** Elements whose *content* is markup/metadata, never words the customer wrote. */
const NON_TEXT_ELEMENTS =
    /<(script|style|head|title|noscript|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Elements whose boundary is a visual line break once the markup is gone. */
const BLOCK_BOUNDARY =
    /<\/?(?:address|article|aside|blockquote|br|caption|center|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|option|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;

/**
 * Best-effort plain text from an HTML email body.
 *
 * Nothing in the dependency tree can do this at runtime — `jsdom` is a web-app
 * devDependency (tests only) and the transitive `entities`/`hast` packages under
 * `react-markdown` are not ours to import — so this is a deliberate conservative
 * tag-strip rather than a real parse, and it adds no dependency.
 *
 * What it does badly, accepted knowingly: it does not build a DOM, so it cannot
 * reason about layout — table cells become separate lines, CSS inside an
 * unterminated `<style>` leaks through as text, a `>` inside an attribute value
 * ends a "tag" early, and link targets are dropped (the anchor text survives,
 * the href does not). None of that matters for the two consumers: a human
 * reading the ticket, and the AI job reading the question. Both need the words,
 * not the layout. If HTML fidelity ever does matter, swap this for a parser
 * behind the same signature.
 */
export function htmlToText(html: string | undefined | null): string {
    if (!html) return '';
    const stripped = html
        // Comments first — Outlook wraps whole alternate layouts in conditional
        // comments, and their contents must not survive as text.
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(NON_TEXT_ELEMENTS, ' ')
        .replace(BLOCK_BOUNDARY, '\n')
        .replace(/<[^>]*>/g, '');
    // Decode AFTER stripping so an escaped `&lt;p&gt;` in the customer's text is
    // never re-read as a tag.
    return (
        decodeHtmlEntities(stripped)
            .replace(/\r\n?/g, '\n')
            .replace(/[^\S\n]+/g, ' ')
            .replace(/ *\n */g, '\n')
            // Every run of breaks collapses to ONE newline. Without a DOM there is no
            // way to tell "paragraph gap" from "two adjacent block tags", and Outlook
            // emits one <div> per line — so preserving runs would double-space most
            // real mail. The cost is that genuine blank lines (including inside
            // <pre>) are lost; the words and their line order are not.
            .replace(/\n+/g, '\n')
            .trim()
    );
}

/**
 * Stand-in stored when an inbound email carries no readable text at all.
 *
 * Written as an obvious system note rather than left empty so a human opening
 * the ticket sees why it looks bare instead of a blank bubble. It is never
 * treated as a question — `resolveMessageBody` reports `hasText: false` for it
 * and the route skips the AI job.
 */
export const EMPTY_EMAIL_BODY_PLACEHOLDER = '(This email contained no readable text content.)';

/** Outcome of picking a body off the payload. */
export interface ResolvedMessageBody {
    /** What to persist as the ticket description / message content. */
    content: string;
    /** True when `content` is text the customer actually sent. */
    hasText: boolean;
}

/**
 * Pick the message body off a Postmark payload.
 *
 * Order: `StrippedTextReply` (quoted trail already removed), then `TextBody`,
 * then text derived from `HtmlBody`. The HTML fallback is load-bearing — plenty
 * of senders, Outlook in particular, post `text/html` only, and without it the
 * ticket description, the opening message, and the question handed to the AI job
 * were all empty.
 *
 * `hasText: false` means every source was empty or whitespace. The route still
 * files the ticket — a real customer email must never be dropped, and the
 * subject plus any attachments are still evidence for a human — but it does not
 * enqueue an AI job, because an answer generated from an empty question is
 * strictly worse than no answer: the model falls back to an apology, that
 * apology is delivered to the customer, and the ticket then counts as already
 * answered so the human reply loses its place.
 */
export function resolveMessageBody(
    payload: Pick<PostmarkInboundPayload, 'StrippedTextReply' | 'TextBody' | 'HtmlBody'>,
): ResolvedMessageBody {
    for (const candidate of [payload.StrippedTextReply, payload.TextBody]) {
        if (candidate && candidate.trim().length > 0) return { content: candidate, hasText: true };
    }

    const fromHtml = htmlToText(payload.HtmlBody);
    if (fromHtml.length > 0) return { content: fromHtml, hasText: true };

    return { content: EMPTY_EMAIL_BODY_PLACEHOLDER, hasText: false };
}

/** Postmark inbound webhook payload (relevant fields). */
export interface PostmarkInboundPayload {
    From: string;
    FromName?: string;
    FromFull?: { Email: string; Name: string };
    To: string;
    ToFull?: Array<{ Email: string; Name: string; MailboxHash: string }>;
    Subject: string;
    TextBody: string;
    HtmlBody: string;
    StrippedTextReply?: string;
    MailboxHash?: string;
    MessageID: string;
    Headers?: Array<{ Name: string; Value: string }>;
    Attachments?: Array<{
        Name: string;
        Content: string;
        ContentType: string;
        ContentLength: number;
    }>;
}
