/**
 * Discord MCP server (TypeScript).
 *
 * Exposes 5 read-only tools used by the Weekly Community Signal skill suite:
 *   - list_servers
 *   - get_channels
 *   - list_forum_threads
 *   - read_messages
 *   - read_thread_messages
 *
 * Replaces the Python reference at hanweg/mcp-discord (NathanTarbert fork).
 *
 * Configure once:
 *   pnpm --filter @copilotkit/outpost-discord-mcp build
 *   echo "DISCORD_MCP_TOKEN=..." > apps/discord-mcp/.env
 *   claude mcp add discord --scope user -- node /abs/path/to/outpost/apps/discord-mcp/dist/index.js
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
    Client,
    GatewayIntentBits,
    ChannelType,
    type AnyThreadChannel,
    type ForumChannel,
    type TextBasedChannel,
} from "discord.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ─── env ─────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Local app .env wins; fall back to the monorepo-root .env (dist/ → app → apps → repo root).
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../../../.env") });

// Token sources (only DISCORD_MCP_TOKEN is read today):
//   DISCORD_MCP_TOKEN — Nathan's test bot app; can see all channels/threads in both
//                       CopilotKit + AG-UI servers. Used for the Community Signals report.
//   DISCORD_TOKEN     — org-level bot token (TODO: provision at org level, then switch to it).
const DISCORD_MCP_TOKEN = process.env.DISCORD_MCP_TOKEN;
if (!DISCORD_MCP_TOKEN) {
    console.error("[discord-mcp] DISCORD_MCP_TOKEN missing in environment");
    process.exit(1);
}

// ─── discord client ──────────────────────────────────────────────────────────
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const ready = new Promise<void>((res) => {
    discord.once("ready", () => {
        console.error(`[discord-mcp] logged in as ${discord.user?.tag}`);
        res();
    });
});

discord.login(DISCORD_MCP_TOKEN).catch((err) => {
    console.error("[discord-mcp] login failed:", err);
    process.exit(1);
});

// ─── helpers ─────────────────────────────────────────────────────────────────
function formatReaction(name: string, count: number): string {
    return `${name}(${count})`;
}

function formatMessage(m: {
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
const TOOLS: Tool[] = [
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
async function handleListServers(): Promise<string> {
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

async function handleGetChannels(args: { server_id: string }): Promise<string> {
    const guild = discord.guilds.cache.get(args.server_id);
    if (!guild) return "Guild not found";
    const list = guild.channels.cache
        .map((c) => `#${c.name} (ID: ${c.id}) - ${ChannelType[c.type]}`)
        .join("\n");
    return `Channels in ${guild.name}:\n${list}`;
}

async function handleListForumThreads(args: {
    channel_id: string;
    include_archived?: boolean;
    archived_limit?: number;
}): Promise<string> {
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

async function handleReadMessages(args: {
    channel_id: string;
    limit?: number;
}): Promise<string> {
    const limit = Math.min(args.limit ?? 10, 100);
    const channel = await discord.channels.fetch(args.channel_id);
    if (!channel || !("messages" in channel)) {
        return `Channel ${args.channel_id} is not readable.`;
    }
    return fetchHistory(channel as TextBasedChannel, limit);
}

async function handleReadThreadMessages(args: {
    thread_id: string;
    limit?: number;
}): Promise<string> {
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

// ─── MCP server ──────────────────────────────────────────────────────────────
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
                text = await handleListServers();
                break;
            case "get_channels":
                text = await handleGetChannels(args as { server_id: string });
                break;
            case "list_forum_threads":
                text = await handleListForumThreads(
                    args as {
                        channel_id: string;
                        include_archived?: boolean;
                        archived_limit?: number;
                    },
                );
                break;
            case "read_messages":
                text = await handleReadMessages(
                    args as { channel_id: string; limit?: number },
                );
                break;
            case "read_thread_messages":
                text = await handleReadThreadMessages(
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

// ─── stdio ───────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[discord-mcp] MCP server running on stdio");
