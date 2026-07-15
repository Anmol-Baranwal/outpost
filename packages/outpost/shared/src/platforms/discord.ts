/**
 * Discord Platform Adapter — uses discord.js REST class for stateless HTTP posting.
 *
 * The full Discord client (WebSocket gateway) runs in the discord-bot app.
 * This adapter uses only REST for posting responses from the worker, avoiding
 * the need for a persistent WebSocket connection.
 *
 * discord.js is loaded lazily (dynamic import) so the shared package doesn't
 * need it as a hard dependency — only callers that actually post messages
 * trigger the import.
 */

import { TicketSource } from '../types.js';
import type {
    PlatformAdapter,
    InboundMessage,
    PlatformUser,
    FormattedResponse,
    Attachment,
} from './types.js';

/** Discord message character limit */
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/** Cached discord.js module reference — loaded once on first use. */
let discordJsModule: {
    REST: new (opts: { version: string }) => DiscordREST;
    Routes: typeof import('discord.js').Routes;
} | null = null;

/**
 * Minimal interface matching the discord.js REST class methods we use.
 * Avoids importing the full type at the top level.
 */
interface DiscordREST {
    setToken(token: string): this;
    get(path: string): Promise<unknown>;
    post(path: string, options: { body: Record<string, unknown> }): Promise<unknown>;
}

async function getDiscordJs(): Promise<typeof discordJsModule & object> {
    if (!discordJsModule) {
        discordJsModule = await import('discord.js');
    }
    return discordJsModule;
}

export interface DiscordAdapterConfig {
    token: string;
}

export class DiscordAdapter implements PlatformAdapter {
    readonly platform = TicketSource.DISCORD;
    private readonly token: string;
    private _rest: DiscordREST | null = null;

    constructor(config: DiscordAdapterConfig) {
        this.token = config.token;
    }

    /** Lazily initialize the REST client — avoids creating it when only parsing. */
    private async getRestClient(): Promise<DiscordREST> {
        if (!this._rest) {
            const { REST } = await getDiscordJs();
            this._rest = new REST({ version: '10' }).setToken(this.token);
        }
        return this._rest;
    }

    /**
     * Parse a raw Discord thread/message event into an InboundMessage.
     *
     * Expected rawEvent shape (from discord.js):
     * - For thread create: { thread: ThreadChannel, starterMessage?: Message }
     * - For message: { message: Message }
     *
     * This method is synchronous and does NOT require discord.js to be installed.
     */
    parseInboundEvent(rawEvent: unknown): InboundMessage {
        const event = rawEvent as Record<string, unknown>;

        // Thread create event
        if (event.thread) {
            const thread = event.thread as Record<string, unknown>;
            const starter = event.starterMessage as Record<string, unknown> | undefined;
            const author = starter?.author as Record<string, unknown> | undefined;

            return {
                platformUserId: (author?.id as string) ?? '',
                platformUsername:
                    (author?.tag as string) ?? (author?.username as string) ?? 'Unknown',
                content: (starter?.content as string) ?? '',
                threadId: thread.id as string,
                channelId: thread.parentId as string | undefined,
                sourceUrl: thread.url as string | undefined,
                source: TicketSource.DISCORD,
                attachments: this.parseDiscordAttachments(starter?.attachments),
                isThreadStart: true,
                rawEvent,
            };
        }

        // Regular message event
        const message = (event.message ?? event) as Record<string, unknown>;
        const author = message.author as Record<string, unknown> | undefined;
        const channel = message.channel as Record<string, unknown> | undefined;

        return {
            platformUserId: (author?.id as string) ?? '',
            platformUsername: (author?.tag as string) ?? (author?.username as string) ?? 'Unknown',
            content: (message.content as string) ?? '',
            threadId: (channel?.id as string) ?? '',
            channelId: (channel?.parentId as string) ?? (channel?.id as string) ?? '',
            sourceUrl: message.url as string | undefined,
            source: TicketSource.DISCORD,
            attachments: this.parseDiscordAttachments(message.attachments),
            isThreadStart: false,
            rawEvent,
        };
    }

    async fetchUserInfo(platformUserId: string): Promise<PlatformUser> {
        try {
            const rest = await this.getRestClient();
            const { Routes } = await getDiscordJs();
            const user = (await rest.get(Routes.user(platformUserId))) as Record<string, unknown>;
            return {
                platformId: platformUserId,
                username: (user.username as string) ?? platformUserId,
                displayName: (user.global_name as string) ?? undefined,
                email: undefined, // Discord API does not expose email without OAuth2 scope
                avatarUrl: user.avatar
                    ? `https://cdn.discordapp.com/avatars/${platformUserId}/${user.avatar}.png`
                    : undefined,
            };
        } catch (err) {
            console.warn(`[DiscordAdapter] Failed to fetch user info for ${platformUserId}:`, err);
            return {
                platformId: platformUserId,
                username: platformUserId,
                displayName: undefined,
                email: undefined,
                avatarUrl: undefined,
            };
        }
    }

    /**
     * Post the AI-generated response to the Discord thread.
     *
     * Handles:
     * - Multi-part messages (response.parts) — posts each part sequentially
     * - Long single messages — splits at Discord's 2000-char limit
     * - Action buttons (response.buttons) — attaches ActionRow components to the last message
     */
    async postResponse(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        response: FormattedResponse,
    ): Promise<string | undefined> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post Discord response — ticket ${ticket.id} has no sourceId (thread ID)`,
            );
        }

        const rest = await this.getRestClient();
        const { Routes } = await getDiscordJs();
        const threadId = ticket.sourceId;

        // Determine message parts: use explicit parts if provided, otherwise split the text
        const parts =
            response.parts && response.parts.length > 0
                ? response.parts
                : this.splitMessage(response.text);

        // Post all parts except the last one (without buttons)
        for (let i = 0; i < parts.length - 1; i++) {
            await rest.post(Routes.channelMessages(threadId), {
                body: { content: parts[i] },
            });
        }

        // Post the last part, optionally with action buttons
        const lastPart = parts[parts.length - 1];
        const body: Record<string, unknown> = { content: lastPart };

        if (response.buttons && response.buttons.length > 0) {
            body.components = [
                {
                    type: 1, // ActionRow
                    components: response.buttons.map((btn) => ({
                        type: 2, // Button
                        style: btn.action === 'issue_solved' ? 3 : 1, // SUCCESS : PRIMARY
                        label: btn.label,
                        custom_id: btn.action,
                    })),
                },
            ];
        }

        await rest.post(Routes.channelMessages(threadId), { body });
        return undefined;
    }

    /**
     * Post a system-level message (acknowledgments, status updates, errors) to a thread.
     */
    async postSystemMessage(
        ticket: {
            id: string;
            sourceId: string | null;
            channel: string | null;
            source: TicketSource;
        },
        message: string,
    ): Promise<void> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post Discord system message — ticket ${ticket.id} has no sourceId (thread ID)`,
            );
        }

        const rest = await this.getRestClient();
        const { Routes } = await getDiscordJs();
        const threadId = ticket.sourceId;
        const parts = this.splitMessage(message);

        for (const part of parts) {
            await rest.post(Routes.channelMessages(threadId), {
                body: { content: part },
            });
        }
    }

    /**
     * Split a message into chunks that respect Discord's 2000-character limit.
     * Tries to split on newlines first, then on spaces, then hard-splits.
     */
    private splitMessage(text: string): string[] {
        if (text.length <= DISCORD_MAX_MESSAGE_LENGTH) {
            return [text];
        }

        const parts: string[] = [];
        let remaining = text;

        while (remaining.length > DISCORD_MAX_MESSAGE_LENGTH) {
            let splitAt = remaining.lastIndexOf('\n', DISCORD_MAX_MESSAGE_LENGTH);
            if (splitAt === -1 || splitAt < DISCORD_MAX_MESSAGE_LENGTH / 2) {
                splitAt = remaining.lastIndexOf(' ', DISCORD_MAX_MESSAGE_LENGTH);
            }
            if (splitAt === -1 || splitAt < DISCORD_MAX_MESSAGE_LENGTH / 2) {
                splitAt = DISCORD_MAX_MESSAGE_LENGTH;
            }

            parts.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trimStart();
        }

        if (remaining.length > 0) {
            parts.push(remaining);
        }

        return parts;
    }

    private parseDiscordAttachments(raw: unknown): Attachment[] | undefined {
        if (!raw) return undefined;

        // discord.js attachments can be a Collection or array
        const items = Array.isArray(raw)
            ? raw
            : typeof raw === 'object' && raw !== null && Symbol.iterator in raw
              ? Array.from(raw as Iterable<unknown>)
              : [];

        if (items.length === 0) return undefined;

        return items.map((item: unknown) => {
            const a = item as Record<string, unknown>;
            // discord.js Collection entries are [key, value] tuples
            const attachment = Array.isArray(a) ? (a[1] as Record<string, unknown>) : a;
            return {
                filename:
                    (attachment.name as string) ?? (attachment.filename as string) ?? 'unknown',
                url: (attachment.url as string) ?? '',
                size: attachment.size as number | undefined,
                contentType: (attachment.contentType as string) ?? undefined,
            };
        });
    }
}
