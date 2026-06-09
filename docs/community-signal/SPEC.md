# CLAUDE.md

This project tracks community signals across **CopilotKit + AG-UI** Discord + GitHub and produces weekly Notion reports under the [Community Signals](https://www.notion.so/copilotkit/Community-Signals-3673aa38185280bca71fd328d765668d) parent page.

## How to use

Skills live in `.claude/skills/` and load progressively on intent. Don't pull all rules into your main context — invoke the right skill.

| Trigger | Skill |
|---|---|
| "go" / "weekly report" / "community signals" / "run routine" | `weekly-report` (orchestrator — spawns subagents for Discord, GitHub, deep-read, enrichment) |
| "find all reports about X in last N days" / "search across both communities" | `topic-search` |
| "enterprise report" / "who at enterprise this week" / "enterprise status" | `enterprise` |
| (invoked by weekly-report) | `front-door-triage` · `deep-read-issue` · `enrich-reporter` |
| "draft Slack TL;DR" / "build the Slack message" | `slack-tldr` |

## Architecture — orchestrator + subagents

`weekly-report` is the orchestrator. It **delegates** to subagents so the main thread's context stays small:

```
weekly-report (main)
├─→ Discord pull subagent      (per-channel substantive summaries)
├─→ GitHub pull subagent       (issue lists, both repos, tagged by community)
├─→ deep-read-issue subagent   (file paths, reviewer concerns, hidden bugs)
├─→ enrich-reporter subagent   (gh api users/<login>, enterprise classify)
└─→ Synthesize → Notion page + Slack JSON via slack-tldr
```

Each subagent has its own context window. The orchestrator sees only compact returns.

## Communities

- **CopilotKit** — Discord server `1122926057641742418` · GitHub `CopilotKit/CopilotKit`
- **AG-UI** — Discord server `1379082175625953370` · GitHub `ag-ui-protocol/ag-ui`

Channels mapped per community in the `weekly-report` skill.

## Conventions (cross-skill)

- Read-only on Discord. Never post.
- Reports are **company-readable** (product, marketing, leadership, sales/CS, engineering) — strip orchestrator process notes.
- Convert relative dates to absolute ISO so pages stay interpretable later.
- Reconfirm the date window before pulling data so a wrong week is caught early.
- Forum thread URL format: `https://discord.com/channels/<guild_id>/<thread_id>` — parent forum channel ID NOT in URL.
- Every Discord mention is a hyperlink. Every named entity in 🔄 Patterns is hyperlinked.
- Dated report lists go oldest → newest. Bullets = one sentence; depth lives in 🔄 Patterns.

Detailed rules live in each skill file.
