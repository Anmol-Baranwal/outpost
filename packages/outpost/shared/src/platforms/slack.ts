/**
 * Slack PlatformAdapter implementation.
 *
 * Translates Slack message events into InboundMessages and
 * posts responses back to Slack threads via the @slack/web-api WebClient.
 */

import { WebClient } from '@slack/web-api';
import { TicketSource } from '../types.js';
import type { PlatformAdapter, InboundMessage, PlatformUser, FormattedResponse } from './types.js';

// ─── Slack event shape (minimal subset we inspect) ──────────────────────────

export interface SlackMessageEvent {
    type?: string;
    subtype?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    channel?: string;
}

export interface SlackAdapterConfig {
    /** Slack bot OAuth token (xoxb-...). */
    token: string;
}

export class SlackAdapter implements PlatformAdapter {
    readonly platform = TicketSource.SLACK;
    private readonly client: WebClient;

    constructor(config: SlackAdapterConfig) {
        this.client = new WebClient(config.token);
    }

    // ── parseInboundEvent ────────────────────────────────────────────────

    parseInboundEvent(rawEvent: unknown): InboundMessage {
        const event = rawEvent as SlackMessageEvent;
        const userId = event.user ?? '';
        const channelId = event.channel;

        // Determine if this is a threaded reply or a top-level message.
        // thread_ts === ts means the message IS the thread parent (top-level).
        const isThreadReply = !!(event.thread_ts && event.thread_ts !== event.ts);

        // For top-level messages the threadId is the ts.
        // For threaded replies we use thread_ts (the parent ts)
        // so all replies map to the same ticket.
        const threadId = isThreadReply ? event.thread_ts! : (event.ts ?? '');

        const sourceUrl = channelId && threadId ? buildPermalink(channelId, threadId) : undefined;

        return {
            platformUserId: userId,
            platformUsername: `slack:${userId}`,
            content: event.text ?? '',
            threadId,
            channelId,
            sourceUrl,
            source: TicketSource.SLACK,
            isThreadStart: !isThreadReply,
            rawEvent,
        };
    }

    // ── fetchUserInfo ───────────────────────────────────────────────────

    async fetchUserInfo(platformUserId: string): Promise<PlatformUser> {
        try {
            const result = await this.client.users.info({ user: platformUserId });
            const user = result.user as Record<string, unknown> | undefined;
            const profile = user?.profile as Record<string, unknown> | undefined;

            return {
                platformId: platformUserId,
                username: (user?.name as string) ?? platformUserId,
                displayName:
                    (profile?.display_name as string) ??
                    (profile?.real_name as string) ??
                    undefined,
                email: (profile?.email as string) ?? undefined,
                avatarUrl: (profile?.image_72 as string) ?? undefined,
            };
        } catch (err) {
            console.warn(`[SlackAdapter] Failed to fetch user info for ${platformUserId}:`, err);
            return {
                platformId: platformUserId,
                username: platformUserId,
            };
        }
    }

    // ── postResponse ─────────────────────────────────────────────────────

    async postResponse(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        response: FormattedResponse,
    ): Promise<string | undefined> {
        if (!ticket.sourceId || !ticket.channel) {
            throw new Error(
                `Cannot post Slack response — ticket ${ticket.id} missing sourceId or channel`,
            );
        }

        // sourceId is "channelId:threadTs" — extract the thread_ts
        const threadTs = extractThreadTs(ticket.sourceId);

        // Build Block Kit blocks for richer formatting
        const blocks: Array<Record<string, unknown>> = [];

        // Main response body
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: response.text,
            },
        });

        await this.client.chat.postMessage({
            channel: ticket.channel,
            thread_ts: threadTs,
            text: response.text, // Fallback for notifications
            blocks: blocks as any,
        });
        return undefined;
    }

    // ── postSystemMessage ────────────────────────────────────────────────

    async postSystemMessage(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        message: string,
    ): Promise<void> {
        if (!ticket.sourceId || !ticket.channel) {
            throw new Error(
                `Cannot post Slack system message — ticket ${ticket.id} missing sourceId or channel`,
            );
        }

        const threadTs = extractThreadTs(ticket.sourceId);

        await this.client.chat.postMessage({
            channel: ticket.channel,
            thread_ts: threadTs,
            text: message,
        });
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a Slack permalink URL for a thread message.
 */
export function buildPermalink(channelId: string, threadTs: string): string {
    const tsNoDot = threadTs.replace('.', '');
    return `https://slack.com/archives/${channelId}/p${tsNoDot}`;
}

/**
 * Extract thread_ts from a sourceId of the form "channelId:threadTs".
 */
function extractThreadTs(sourceId: string): string {
    const colonIdx = sourceId.indexOf(':');
    return colonIdx >= 0 ? sourceId.slice(colonIdx + 1) : sourceId;
}
