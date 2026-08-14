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

/** Read a header value case-insensitively (SMTP header names are not case-sensitive). */
export function getHeaderValue(
    headers: Array<{ Name: string; Value: string }> | undefined,
    name: string,
): string | undefined {
    if (!headers?.length) return undefined;
    const wanted = name.toLowerCase();
    return headers.find((h) => h?.Name?.toLowerCase() === wanted)?.Value;
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
    return REPLY_HEADERS.some((name) => (getHeaderValue(headers, name) ?? '').trim().length > 0);
}

/**
 * Collect every candidate Message-ID a reply points at, normalized and deduped.
 *
 * `In-Reply-To` alone is not enough: when a customer replies to a message
 * Outpost sent, it names an outbound Message-ID we never persisted. `References`
 * accumulates the whole thread chain, so it still contains the customer's own
 * opening Message-ID — the value stored as `Ticket.sourceId`.
 *
 * Order is In-Reply-To first, then the References chain as sent (oldest →
 * newest). Callers match the whole set at once, so order is informational.
 */
export function extractReplyMessageIds(
    headers: Array<{ Name: string; Value: string }> | undefined,
): string[] {
    const ids: string[] = [];
    for (const name of REPLY_HEADERS) {
        const value = getHeaderValue(headers, name);
        if (!value) continue;
        // References is whitespace-separated; tolerate comma-separated clients.
        for (const token of value.split(/[\s,]+/)) {
            const id = normalizeMessageId(token);
            if (id && !ids.includes(id)) ids.push(id);
        }
    }
    return ids;
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
