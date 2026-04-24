/**
 * Email Platform Adapter (Postmark) — handles inbound and outbound email via Postmark.
 *
 * Stub implementation to be filled by B12. Provides the correct interface
 * and constructor signature for the Postmark email provider.
 */

import { TicketSource } from '../types.js';
import type {
    PlatformAdapter,
    InboundMessage,
    PlatformUser,
    FormattedResponse,
} from './types.js';

export interface EmailPostmarkAdapterConfig {
    apiKey: string;
    fromEmail: string;
}

export class EmailPostmarkAdapter implements PlatformAdapter {
    readonly platform = TicketSource.EMAIL;
    private readonly config: EmailPostmarkAdapterConfig;

    constructor(config: EmailPostmarkAdapterConfig) {
        this.config = config;
    }

    /**
     * Parse a raw Postmark inbound webhook into an InboundMessage.
     *
     * Expected rawEvent shape (Postmark inbound webhook):
     * {
     *   FromFull: { Email: '...', Name: '...' },
     *   ToFull: [{ Email: '...', Name: '...' }],
     *   Subject: '...',
     *   TextBody: '...',
     *   HtmlBody: '...',
     *   MessageID: '...',
     *   Headers: [{ Name: '...', Value: '...' }],
     *   Attachments: [{ Name: '...', Content: '...', ContentType: '...', ContentLength: 123 }]
     * }
     */
    parseInboundEvent(rawEvent: unknown): InboundMessage {
        const event = rawEvent as Record<string, unknown>;
        const fromFull = event.FromFull as Record<string, unknown> | undefined;
        const email = (fromFull?.Email as string) ?? '';
        const name = (fromFull?.Name as string) ?? email;
        const subject = (event.Subject as string) ?? '';
        const textBody = (event.TextBody as string) ?? '';
        const messageId = (event.MessageID as string) ?? '';

        // Check for In-Reply-To header to determine if this is a reply
        const headers = (event.Headers as Array<Record<string, string>>) ?? [];
        const inReplyTo = headers.find(h => h.Name === 'In-Reply-To')?.Value;
        const isThreadStart = !inReplyTo;

        // Use subject line as content identifier for threading
        const content = textBody || subject;

        return {
            platformUserId: email,
            platformUsername: name,
            content,
            threadId: inReplyTo ?? messageId,
            channelId: undefined,
            sourceUrl: undefined,
            source: TicketSource.EMAIL,
            isThreadStart,
            rawEvent,
        };
    }

    async fetchUserInfo(platformUserId: string): Promise<PlatformUser> {
        // Email users are identified by their email address
        return {
            platformId: platformUserId,
            username: platformUserId,
            displayName: undefined,
            email: platformUserId,
            avatarUrl: undefined,
        };
    }

    async postResponse(
        _ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        _response: FormattedResponse,
    ): Promise<void> {
        throw new Error('EmailPostmarkAdapter.postResponse not yet implemented');
    }

    async postSystemMessage(
        _ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        _message: string,
    ): Promise<void> {
        throw new Error('EmailPostmarkAdapter.postSystemMessage not yet implemented');
    }
}
