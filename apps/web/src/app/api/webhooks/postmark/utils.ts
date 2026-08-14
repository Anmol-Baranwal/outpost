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
            if (ids.length >= MAX_REPLY_MESSAGE_IDS) return ids;
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
