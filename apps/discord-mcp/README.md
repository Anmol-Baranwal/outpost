# @copilotkit/outpost-discord-mcp

Discord MCP server (TypeScript). Exposes 5 read-only tools used by the [Weekly Community Signal](../../docs/community-signal/README.md) skill suite — listing servers, listing channels, listing forum threads, reading messages, reading thread messages.

Replaces the Python reference at [hanweg/mcp-discord](https://github.com/hanweg/mcp-discord) / [NathanTarbert/mcp-discord](https://github.com/NathanTarbert/mcp-discord). Vendored in-repo so engineers don't need an external clone.

## Setup

```bash
# 1. Install + build
pnpm install
pnpm --filter @copilotkit/outpost-discord-mcp build

# 2. Configure token (gitignored)
cp apps/discord-mcp/.env.example apps/discord-mcp/.env
# edit apps/discord-mcp/.env and set DISCORD_MCP_TOKEN=...

# 3. Launch Claude Code in this repo
claude
# → first run: Claude prompts "Trust this MCP server?" for the entry
#   in .mcp.json at repo root. Approve once; persists per machine.
```

Verify it connected:

```bash
claude mcp list | grep discord     # expect ✔ Connected
```

The Discord MCP server is registered via [`.mcp.json`](../../.mcp.json) at the repo root — Claude Code auto-discovers it when launched here. No manual `claude mcp add` needed; cloning the repo + `pnpm install` is the full setup.

## Env var

`DISCORD_MCP_TOKEN` is **specifically for the Community Signals workflow** and is intentionally **separate from `DISCORD_TOKEN`** used by [`apps/discord-bot`](../discord-bot/). Two reasons to keep them apart:

1. Different bot identities — the support-ingest bot (`apps/discord-bot`) and the community-signals reader (`apps/discord-mcp`) can be different Discord apps with different permissions and audit trails.
2. No accidental sharing — the MCP server is invoked from local Claude Code sessions during the manual weekly routine; the ingest bot runs server-side. Crossing the streams would let either path act as the other.

Set `DISCORD_MCP_TOKEN` in `apps/discord-mcp/.env` (gitignored). Don't put it in any root-level `.env` where `apps/discord-bot` reads from.

## Bot requirements

Discord bot must have the following intents enabled in the Developer Portal:

- **Server Members Intent** (for `list_members`-style reads)
- **Message Content Intent** (for `read_messages` / `read_thread_messages`)

And be invited to each guild you want to read from with at minimum **View Channels** + **Read Message History** permissions.

## Tools

| Tool | Purpose |
|---|---|
| `list_servers` | Enumerate guilds the bot is a member of |
| `get_channels` | List channels in a guild (by `server_id`) |
| `list_forum_threads` | List active + archived threads in a forum channel |
| `read_messages` | Read recent messages from a text channel |
| `read_thread_messages` | Read recent messages from a thread (forum or otherwise) |

## Development

```bash
pnpm --filter @copilotkit/outpost-discord-mcp dev   # tsx watch
pnpm --filter @copilotkit/outpost-discord-mcp test
pnpm --filter @copilotkit/outpost-discord-mcp typecheck
```

## Notes

- Server logs to **stderr** (info-level logs about login + connection). MCP JSON-RPC traffic is on **stdout**. Mixing the two breaks the protocol; don't `console.log` from the handler path.
- Forum thread URL format for cross-references: `https://discord.com/channels/<guild_id>/<thread_id>`. The parent forum channel ID is **not** part of the URL.
