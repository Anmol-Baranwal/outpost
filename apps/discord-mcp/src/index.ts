/**
 * Discord MCP server (TypeScript) — bootstrap.
 *
 * Exposes 5 read-only tools used by the Weekly Community Signal skill suite:
 *   - list_servers
 *   - get_channels
 *   - list_forum_threads
 *   - read_messages
 *   - read_thread_messages
 *
 * The tool logic + MCP wiring lives in `server.ts` (importable without side
 * effects); this file only loads env, logs in, and connects stdio.
 *
 * Configure once:
 *   pnpm --filter @copilotkit/outpost-discord-mcp build
 *   echo "DISCORD_MCP_TOKEN=..." > apps/discord-mcp/.env   # or set it in the repo-root .env
 *   claude mcp add discord --scope user -- node /abs/path/to/outpost/apps/discord-mcp/dist/index.js
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDiscordServer, requireToken } from "./server.js";

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
const DISCORD_MCP_TOKEN = (() => {
    try {
        return requireToken();
    } catch (err) {
        console.error(`[discord-mcp] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
})();

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

// ─── MCP server over stdio ─────────────────────────────────────────────────────
const server = createDiscordServer(discord, { ready });
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[discord-mcp] MCP server running on stdio");
