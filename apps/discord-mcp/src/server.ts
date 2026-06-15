/**
 * Discord MCP server — testable core.
 *
 * This module holds everything that can be exercised without a live Discord
 * connection: the tool definitions, the per-tool handlers (each takes the
 * Discord client as an argument so it can be mocked), the message formatters,
 * the token guard, and `createDiscordServer()` which wires an MCP `Server`.
 *
 * The side-effectful bootstrap (env loading, `discord.login`, stdio transport)
 * lives in `index.ts` so importing this module never touches the network.
 */

import {
    ChannelType,
    type Client,
    type AnyThreadChannel,
    type ForumChannel,
    type TextBasedChannel,
} from "discord.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ─── token ─────────────────────────────────────────────────────────────────
/**
 * Resolve the Discord bot token, throwing a clear error if it is absent.
 * Reads `DISCORD_MCP_TOKEN` (Nathan's test bot today; the org `DISCORD_TOKEN`
 * is reserved for later org-level provisioning).
 */
export function requireToken(env: NodeJS.ProcessEnv = process.env): string {
    const token = env.DISCORD_MCP_TOKEN;
    if (!token) {
        throw new Error("DISCORD_MCP_TOKEN missing in environment");
    }
    return token;
}

// ─── formatters ──────────────────────────────────────────────────────────────
export function formatReaction(name: string, count: number): string {
    return `${name}(${count})`;
}

export function formatMessage(m: {
    id: string;
    author: string;
    content: string;
    timestamp: string;
    reactions: { emoji: string; count: number }[];
}): string {
    const reactions = m.reactions.length
        ? m.reactions.map((r) => formatReaction(r.emoji, r.count)).join(", ")
        : "No reactions";
    return `${m.author} (${m.timestamp}): ${m.content}\nReactions: ${reactions}`;
}

// ─── tool definitions ────────────────────────────────────────────────────────
export const TOOLS: Tool[] = [
    {
        name: "list_servers",
        description:
            "Get a list of all Discord servers the bot has access to with their details such as name, id, member count, and creation date.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "get_channels",
        description: "Get a list of all channels in a Discord server",
        inputSchema: {
            type: "object",
            properties: {
                server_id: { type: "string", description: "Discord server (guild) ID" },
            },
            required: ["server_id"],
        },
    },
    {
        name: "list_forum_threads",
        description:
            "List threads in a Discord forum channel (active threads and, optionally, archived ones). Use this before read_thread_messages to discover thread IDs in a forum.",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "Forum channel ID" },
                include_archived: {
                    type: "boolean",
                    description: "Include archived threads (default: true)",
                },
                archived_limit: {
                    type: "number",
                    description: "Max archived threads to fetch (default 50, max 200)",
                    minimum: 1,
                    maximum: 200,
                },
            },
            required: ["channel_id"],
        },
    },
    {
        name: "read_messages",
        description: "Read recent messages from a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "Discord channel ID" },
                limit: {
                    type: "number",
                    description: "Number of messages to fetch (max 100)",
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: ["channel_id"],
        },
    },
    {
        name: "read_thread_messages",
        description:
            "Read recent messages from a Discord thread (e.g. a thread inside a forum channel). Pass a thread_id obtained from list_forum_threads.",
        inputSchema: {
            type: "object",
            properties: {
                thread_id: { type: "string", description: "Discord thread ID" },
                limit: {
                    type: "number",
                    description: "Number of messages to fetch (max 100)",
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: ["thread_id"],
        },
    },
];

// ─── tool handlers ───────────────────────────────────────────────────────────
export async function handleListServers(discord: Client): Promise<string> {
    const servers = discord.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        member_count: g.memberCount,
        created_at: g.createdAt.toISOString(),
    }));
    return (
        `Available Servers (${servers.length}):\n` +
        servers
            .map((s) => `${s.name} (ID: ${s.id}, Members: ${s.member_count})`)
            .join("\n")
    );
}

export async function handleGetChannels(
    discord: Client,
    args: { server_id: string },
): Promise<string> {
    const guild = discord.guilds.cache.get(args.server_id);
    if (!guild) return "Guild not found";
    const list = guild.channels.cache
        .map((c) => `#${c.name} (ID: ${c.id}) - ${ChannelType[c.type]}`)
        .join("\n");
    return `Channels in ${guild.name}:\n${list}`;
}

export async function handleListForumThreads(
    discord: Client,
    args: {
        channel_id: string;
        include_archived?: boolean;
        archived_limit?: number;
    },
): Promise<string> {
    const channel = await discord.channels.fetch(args.channel_id);
    if (!channel || channel.type !== ChannelType.GuildForum) {
        return `Channel ${args.channel_id} is not a forum channel.`;
    }
    const forum = channel as ForumChannel;
    const includeArchived = args.include_archived ?? true;
    const archivedLimit = Math.min(args.archived_limit ?? 50, 200);

    const threads: Array<{
        id: string;
        name: string;
        archived: boolean;
        created_at: string | null;
        message_count: number;
        owner_id: string | null;
    }> = [];

    for (const t of forum.threads.cache.values()) {
        threads.push({
            id: t.id,
            name: t.name,
            archived: t.archived ?? false,
            created_at: t.createdAt?.toISOString() ?? null,
            message_count: t.messageCount ?? 0,
            owner_id: t.ownerId ?? null,
        });
    }

    if (includeArchived) {
        const fetched = await forum.threads.fetchArchived({ limit: archivedLimit });
        for (const t of fetched.threads.values()) {
            threads.push({
                id: t.id,
                name: t.name,
                archived: true,
                created_at: t.createdAt?.toISOString() ?? null,
                message_count: t.messageCount ?? 0,
                owner_id: t.ownerId ?? null,
            });
        }
    }

    return (
        `Threads in #${forum.name} (${threads.length}):\n` +
        threads
            .map(
                (t) =>
                    `- ${t.name} (ID: ${t.id}, archived=${t.archived}, msgs=${t.message_count}, created=${t.created_at}, owner=${t.owner_id})`,
            )
            .join("\n")
    );
}

async function fetchHistory(
    channel: TextBasedChannel | AnyThreadChannel,
    limit: number,
): Promise<string> {
    const messages = await channel.messages.fetch({ limit });
    const formatted = messages.map((m) => {
        const reactions = m.reactions.cache.map((r) => ({
            emoji: r.emoji.name ?? r.emoji.id ?? "?",
            count: r.count,
        }));
        return formatMessage({
            id: m.id,
            author: m.author.username,
            content: m.content,
            timestamp: m.createdAt.toISOString(),
            reactions,
        });
    });
    return `Retrieved ${formatted.length} messages:\n\n${formatted.join("\n")}`;
}

export async function handleReadMessages(
    discord: Client,
    args: { channel_id: string; limit?: number },
): Promise<string> {
    const limit = Math.min(args.limit ?? 10, 100);
    const channel = await discord.channels.fetch(args.channel_id);
    if (!channel || !("messages" in channel)) {
        return `Channel ${args.channel_id} is not readable.`;
    }
    return fetchHistory(channel as TextBasedChannel, limit);
}

export async function handleReadThreadMessages(
    discord: Client,
    args: { thread_id: string; limit?: number },
): Promise<string> {
    const limit = Math.min(args.limit ?? 50, 100);
    const channel = await discord.channels.fetch(args.thread_id);
    if (!channel || !channel.isThread()) {
        return `Channel ${args.thread_id} is not a thread.`;
    }
    const thread = channel as AnyThreadChannel;
    const messages = await thread.messages.fetch({ limit });
    const formatted = messages.map((m) => {
        const reactions = m.reactions.cache.map((r) => ({
            emoji: r.emoji.name ?? r.emoji.id ?? "?",
            count: r.count,
        }));
        return formatMessage({
            id: m.id,
            author: m.author.username,
            content: m.content,
            timestamp: m.createdAt.toISOString(),
            reactions,
        });
    });
    return `Thread '${thread.name}' (${formatted.length} messages):\n\n${formatted.join("\n")}`;
}

// ─── MCP server factory ───────────────────────────────────────────────────────
/**
 * Build an MCP `Server` wired to the five read-only Discord tools.
 *
 * @param discord  a connected (or mocked) discord.js Client
 * @param opts.ready  resolves once the client has logged in; CallTool waits on
 *                    it before touching the client. Defaults to already-resolved
 *                    (handy for tests with a synchronous mock).
 */
export function createDiscordServer(
    discord: Client,
    opts: { ready?: Promise<void> } = {},
): Server {
    const ready = opts.ready ?? Promise.resolve();
    const server = new Server(
        { name: "discord", version: "0.1.0" },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        await ready;
        const { name, arguments: args } = req.params;
        let text: string;
        try {
            switch (name) {
                case "list_servers":
                    text = await handleListServers(discord);
                    break;
                case "get_channels":
                    text = await handleGetChannels(discord, args as { server_id: string });
                    break;
                case "list_forum_threads":
                    text = await handleListForumThreads(
                        discord,
                        args as {
                            channel_id: string;
                            include_archived?: boolean;
                            archived_limit?: number;
                        },
                    );
                    break;
                case "read_messages":
                    text = await handleReadMessages(
                        discord,
                        args as { channel_id: string; limit?: number },
                    );
                    break;
                case "read_thread_messages":
                    text = await handleReadThreadMessages(
                        discord,
                        args as { thread_id: string; limit?: number },
                    );
                    break;
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (err) {
            text = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        return { content: [{ type: "text", text }] };
    });

    return server;
}
