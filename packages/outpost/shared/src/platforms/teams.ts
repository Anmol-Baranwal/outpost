/**
 * TeamsAdapter — PlatformAdapter implementation for Microsoft Teams.
 *
 * Handles parsing Bot Framework activities into InboundMessage objects,
 * and posting proactive messages back to Teams conversations using stored
 * ConversationReference data.
 */

import { TicketSource } from '../types.js';
import type {
    PlatformAdapter,
    InboundMessage,
    PlatformUser,
    FormattedResponse,
} from './types.js';

/**
 * Minimal shape of a Bot Framework Activity, extracted to avoid pulling
 * the entire botbuilder dependency into the shared package.
 */
export interface TeamsActivity {
    type: string;
    text?: string;
    from: {
        id: string;
        name?: string;
        aadObjectId?: string;
    };
    recipient?: {
        id: string;
        name?: string;
    };
    conversation: {
        id: string;
        tenantId?: string;
    };
    channelData?: {
        teamsChannelId?: string;
        [key: string]: unknown;
    };
    channelId?: string;
    serviceUrl?: string;
    replyToId?: string;
    value?: unknown;
}

/**
 * Serializable ConversationReference for proactive messaging.
 * Stored in ticket.additionalInfo so the worker can message the
 * conversation later without the original TurnContext.
 */
export interface TeamsConversationReference {
    serviceUrl: string;
    conversationId: string;
    tenantId?: string;
    botId: string;
    botName?: string;
}

export interface TeamsAdapterConfig {
    appId: string;
    appPassword: string;
    tenantId?: string;
}

export class TeamsAdapter implements PlatformAdapter {
    readonly platform = TicketSource.TEAMS;
    private config: TeamsAdapterConfig;

    constructor(config: TeamsAdapterConfig) {
        this.config = config;
    }

    /**
     * Parse a Bot Framework Activity into a normalized InboundMessage.
     * Returns the canonical InboundMessage shape.
     */
    parseInboundEvent(rawEvent: unknown): InboundMessage {
        const activity = rawEvent as TeamsActivity;

        const conversationId = activity.conversation.id;
        const channelId = activity.channelData?.teamsChannelId;
        const content = activity.text ?? '';
        const authorName = activity.from.name ?? 'Unknown';
        const authorId = activity.from.aadObjectId ?? activity.from.id;
        const isReply = !!activity.replyToId;

        // Build a deep link for the conversation
        const tenantId = this.config.tenantId ?? activity.conversation.tenantId;
        let sourceUrl = `https://teams.microsoft.com/l/message/${conversationId}`;
        if (tenantId) {
            sourceUrl += `?tenantId=${tenantId}`;
        }

        // Build ConversationReference for proactive messaging
        const conversationRef: TeamsConversationReference = {
            serviceUrl: activity.serviceUrl ?? 'https://smba.trafficmanager.net/teams/',
            conversationId,
            tenantId: tenantId ?? undefined,
            botId: activity.recipient?.id ?? '',
            botName: activity.recipient?.name,
        };

        return {
            platformUserId: authorId,
            platformUsername: authorName,
            content,
            threadId: conversationId,
            channelId,
            sourceUrl,
            source: TicketSource.TEAMS,
            isThreadStart: !isReply,
            rawEvent: { ...(rawEvent as Record<string, unknown>), conversationRef },
        };
    }

    // ── fetchUserInfo ───────────────────────────────────────────────────

    async fetchUserInfo(platformUserId: string): Promise<PlatformUser> {
        // Teams user lookup requires Microsoft Graph API access.
        // For now, return minimal info based on what we have.
        return {
            platformId: platformUserId,
            username: platformUserId,
        };
    }

    /**
     * Post an AI response to the Teams conversation associated with a ticket.
     *
     * Uses the Bot Framework REST API directly with the stored ConversationReference,
     * so this can be called from the worker without a live TurnContext.
     */
    async postResponse(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource; additionalInfo?: Record<string, unknown> },
        response: FormattedResponse,
    ): Promise<void> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post Teams response — ticket ${ticket.id} has no sourceId`,
            );
        }

        // Build Adaptive Card payload for the response
        const card = this.buildResponseCard(ticket, response);
        const messagePayload = {
            type: 'message',
            attachments: [
                {
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    content: card,
                },
            ],
        };

        const convRef = (ticket.additionalInfo?.conversationReference as Record<string, unknown>) ?? undefined;
        const serviceUrl = (convRef?.serviceUrl as string) ?? undefined;
        await this.sendToConversation(ticket.sourceId, messagePayload, serviceUrl);
    }

    /**
     * Post a system/status message to the Teams conversation.
     */
    async postSystemMessage(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource; additionalInfo?: Record<string, unknown> },
        message: string,
    ): Promise<void> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post Teams system message — ticket ${ticket.id} has no sourceId`,
            );
        }

        const messagePayload = {
            type: 'message',
            text: message,
        };

        const convRef = (ticket.additionalInfo?.conversationReference as Record<string, unknown>) ?? undefined;
        const serviceUrl = (convRef?.serviceUrl as string) ?? undefined;
        await this.sendToConversation(ticket.sourceId, messagePayload, serviceUrl);
    }

    /**
     * Send a message to a Teams conversation using the Bot Framework REST API.
     *
     * Authenticates via the Microsoft Bot Framework token endpoint and then
     * posts to the conversation's activity endpoint.
     */
    private async sendToConversation(
        conversationId: string,
        payload: Record<string, unknown>,
        serviceUrl?: string,
    ): Promise<void> {
        const token = await this.getBotToken();
        if (!token) {
            throw new Error('[TeamsAdapter] Failed to obtain bot token for proactive message');
        }

        const baseUrl = serviceUrl ?? 'https://smba.trafficmanager.net/teams/';
        const url =
            `${baseUrl}v3/conversations/${encodeURIComponent(conversationId)}/activities`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                ...payload,
                from: { id: this.config.appId },
                conversation: { id: conversationId },
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '(no body)');
            throw new Error(
                `[TeamsAdapter] Failed to send message: ${response.status} ${body}`,
            );
        }
    }

    /**
     * Get a Bot Framework access token using client credentials.
     *
     * Uses the Microsoft identity platform v2.0 token endpoint:
     * https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token
     */
    private async getBotToken(): Promise<string | null> {
        const tokenUrl =
            'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';

        try {
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: this.config.appId,
                    client_secret: this.config.appPassword,
                    scope: 'https://api.botframework.com/.default',
                }),
            });

            if (!response.ok) {
                console.error(
                    `[TeamsAdapter] Token request failed: ${response.status} ${response.statusText}`,
                );
                return null;
            }

            const data = (await response.json()) as { access_token?: string };
            return data.access_token ?? null;
        } catch (error) {
            console.error('[TeamsAdapter] Token request error:', error);
            return null;
        }
    }

    /**
     * Build an Adaptive Card for an AI response.
     */
    private buildResponseCard(
        _ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        response: FormattedResponse,
    ): Record<string, unknown> {
        const body: Record<string, unknown>[] = [
            {
                type: 'TextBlock',
                text: response.text,
                wrap: true,
            },
        ];

        return {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body,
        };
    }
}
