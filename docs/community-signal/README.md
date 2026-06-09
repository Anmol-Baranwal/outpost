# Weekly Community Signal — workflow contribution

This directory contains the **spec + working manual routine** for the cross-source (Discord + GitHub) weekly community report that produces the Notion pages under [Community Signals](https://www.notion.so/copilotkit/Community-Signals-3673aa38185280bca71fd328d765668d).

**Tracking issue:** [#66 — Weekly Community Report](https://github.com/CopilotKit/outpost/issues/66)

**Status:** Draft contribution. The TS implementation in `packages/outpost/*` + `apps/web/*` is engineering-owned and tracked by #66. These files are the reference spec for that build.

## What's here

| File | Purpose |
|---|---|
| `SPEC.md` | Routine spec — cross-skill conventions, audience rule, dated-list ordering, link discipline, identity-collision handling, demotion rules. Copied verbatim from [`NathanTarbert/mcp-discord:CLAUDE.md`](https://github.com/NathanTarbert/mcp-discord/blob/main/CLAUDE.md). |
| `skills/weekly-report/SKILL.md` | Fri→Fri orchestrator — window calc · subagent fan-out (Discord pull · GitHub pull · deep-read · reporter enrichment) · clustering · threshold + trend · Notion page composition · Slack JSON. |
| `skills/front-door-triage/SKILL.md` | Five P0 categories (quickstart broken · agent framework broken · example broken · auth/security blocker · CLI+license flow broken). Threshold-skip override. Surface-beats-wording. Specific-not-generic titles. Rich-repro 📹 + internal-Slack-reference bullets. |
| `skills/deep-read-issue/SKILL.md` | Subagent prompt template for `gh issue view --comments` + `gh pr view --comments` + `gh pr diff` per issue. Procedurally-closed PR rule. Hidden-second-bug detection. |
| `skills/enrich-reporter/SKILL.md` | `gh api users/<login>` enrichment with `companySource` taxonomy. Identity collisions + same-author duplicate-filing rules. |
| `skills/enterprise/SKILL.md` | Enterprise Surfaces table (Enterprise Intelligence · CopilotKit Cloud · License onboarding · Security disclosure channel · Self-host runtime) + Reporters with prior-week trend. |
| `skills/topic-search/SKILL.md` | Generic "find all X in last N days" cross-repo lookup. |
| `skills/slack-tldr/SKILL.md` | Locked Slack JSON payload + post format. |

## How the manual routine maps to Outpost components

| Manual | Outpost | Notes |
|---|---|---|
| `mcp-discord` MCP tool calls | `apps/discord-bot` | Already ingests Discord. Add per-`Community` scoping by `discordGuildId`. AG-UI bot already added (guild `1379082175625953370`). |
| `gh issue list --repo <repo>` | `apps/github-app` | Already ingests. Scope by `Community.githubOrg` + `githubRepos`. |
| `gh api users/<login>` enrichment | `packages/outpost/ai` (or `shared`) | 30-day cache. Folds into existing `User` model — extend with `company` / `companySource` / `companyEnrichedAt` / `bio` / `blog` / `twitterUsername` fields. |
| Threshold rule + trend math (skill spec) | `packages/outpost/ai` (deterministic) | Lives in code, not prompt. Testable + stable across model upgrades. |
| Cluster signals across Discord + GitHub | `packages/outpost/ai` cluster step | v1: deterministic (title similarity + source-ref overlap). v2: AI for borderline matches. |
| Locked Slack TL;DR | `apps/slack-bot` | Posts to `Community.slackChannelId`. Format in `skills/slack-tldr/SKILL.md`. |
| Manual Notion write | Optional `apps/worker` mirror | If `Community.notionParentPageId` set. Defer to v1.5. |

## Schema notes (relevant existing models)

`Reporter` from #66 schema can fold into existing `User`:
- `User.externalId` already holds Discord ID **or** GitHub login.
- `User.accountId` → `Account` is the company aggregation.
- Extend `User` with `company`, `companySource`, `companyEnrichedAt`, `bio`, `blog`, `twitterUsername`.

`Account` already exists for company aggregation (name, domain, sentiment, engagement, acv).

`Ticket` already ingests Discord threads + GitHub issues by source (`TicketSource` enum: `DISCORD` / `GITHUB_ISSUE` / `GITHUB_DISCUSSION` / ...). `CommunitySignalSource` can join to `Ticket.id` rather than re-ingest.

Net-new tables: `Community`, `CommunityReport`, `CommunitySignal`, `CommunitySignalSource`.

## Notion enhanced-Markdown gotchas (from production runs)

- `### Title {toggle="true"}` requires **tab-indented children** to be inside the toggle.
- `<details><summary>` blocks need the **XML `<table>` form** (Markdown pipes break inside `<details>`).
- HTML comments don't render — strip, don't comment.
- Discord forum thread URL: `discord.com/channels/<guild_id>/<thread_id>` — the parent forum channel ID is **not** in the URL.

## Reference reports (fidelity target for dashboard detail view)

- [Weekly Community Signal — May 26-Jun 08, 2026](https://www.notion.so/3783aa38185281e29b0edc64a20e3fdf) (main) + [AG-UI sub-page](https://www.notion.so/3793aa381852818f8f07d986dcf7830d) — current shape with dual-community + collapsibles.
- [Community Issues — May 17-24, 2026](https://www.notion.so/36c3aa3818528147b720c2d33e0e9bd8) — earlier shape before the demand/pain reframe.

## Open decisions for engineering

These are tracked in the [Notion handoff page](https://www.notion.so/37a3aa3818528152a275d6c817d5a28c) and on #66:

1. Deterministic vs AI clustering for v1? (Recommend deterministic.)
2. Notion mirror in v1 or v1.5? (Recommend v1.5.)
3. Fuzzy identity match in v1 or v2? (Recommend v2.)
4. Window-of-record for `carryover open`? (Recommend "while GitHub issue is OPEN.")
5. Bird's-eye view: cross-community pattern aggregation, or siloed? (Recommend siloed for v1.)
6. Cron vs interval scheduler? (Recommend `cronExpression` on `ScheduledJobDefinition`; current scheduler is `setInterval`-only.)

## Coordination

- Workflow artifacts of record live in [`NathanTarbert/mcp-discord`](https://github.com/NathanTarbert/mcp-discord). Changes to the spec land there; these files mirror that source.
- The manual weekly routine continues running from `mcp-discord` until the Outpost dashboard ships.
- Open to walking through any skill or format detail with whoever picks up the build.
