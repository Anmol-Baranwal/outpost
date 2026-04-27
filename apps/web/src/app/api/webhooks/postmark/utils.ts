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
