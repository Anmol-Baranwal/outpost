/**
 * Ticket sourceId key construction — ONE definition, used by both writers
 * and readers.
 *
 * `Ticket.sourceId` is the platform-thread key Outpost uses to decide whether
 * an inbound message opens a new ticket or belongs to an existing one. It is
 * written once (on ticket create) and read on every reply. Those two sites MUST
 * derive the key identically: if they disagree, every reply misses the ticket it
 * belongs to and is filed as a separate untracked one, so the real ticket loses
 * the reply (no message appended, no reopen) and the dashboard fills with
 * duplicate stubs. Do not inline `${channelId}:${threadId}` anywhere; call
 * `buildTicketSourceId`.
 */

import { TicketSource } from '../types.js';

/**
 * Build the `Ticket.sourceId` key for a platform thread, or return `null` when
 * this message cannot produce a thread-addressable key.
 *
 * Rules:
 * - No `threadId` → `null`. A ticket with no thread key cannot be found again
 *   by any lookup, so we refuse to synthesize one (the old code stored `null`
 *   on create but searched for `''` on reply, so the two could never agree).
 *   Callers writing a ticket store `null`; callers reading treat `null` as
 *   "not lookup-able" and must not query.
 * - Slack → composite `"channelId:threadId"`. A Slack `thread_ts` is only
 *   unique within a channel, and `SlackAdapter.postResponse` needs the channel
 *   anyway, so a Slack message with no `channelId` yields `null` rather than a
 *   bare `threadId` that could collide across channels.
 * - Everything else → the `threadId` verbatim (Discord thread ID, Teams
 *   conversation ID, `owner/repo#number` for GitHub, Postmark MessageID).
 *
 * Empty strings count as absent — platform adapters default missing IDs to
 * `''` (see `SlackAdapter.parseInboundEvent`), and `''` is not a usable key.
 */
export function buildTicketSourceId(
    source: TicketSource,
    threadId?: string | null,
    channelId?: string | null,
): string | null {
    if (!threadId) return null;

    if (source === TicketSource.SLACK) {
        if (!channelId) return null;
        return `${channelId}:${threadId}`;
    }

    return threadId;
}
