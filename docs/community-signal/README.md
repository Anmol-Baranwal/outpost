# Weekly Community Signal — workflow + migration map

The cross-source (Discord + GitHub) weekly community report. Today: runnable Claude Code skill suite under [`.claude/skills/`](../../.claude/skills/) at repo root. Soon: native TS implementation inside `packages/outpost/*` + `apps/web/*` tracked by [#66](https://github.com/CopilotKit/outpost/issues/66).

## How to run it today

1. Prereqs (see [`CLAUDE.md`](../../CLAUDE.md)): `mcp-discord` MCP server installed, `gh` CLI authenticated, Notion MCP authenticated, `SLACK_WEBHOOK_URL_1` set in `.claude/settings.local.json` `env` block.
2. From this repo with Claude Code attached: say "go" or "run the weekly report."
3. The `weekly-report` orchestrator pulls Discord + GitHub for both communities, fans out subagents, writes the Notion report under [Community Signals](https://www.notion.so/copilotkit/Community-Signals-3673aa38185280bca71fd328d765668d), and emits a Slack TL;DR JSON.

## What's in the skill suite

See [`CLAUDE.md`](../../CLAUDE.md) for the routine spec + trigger phrases. Skills:

- [`weekly-report`](../../.claude/skills/weekly-report/SKILL.md) — Fri→Fri orchestrator
- [`front-door-triage`](../../.claude/skills/front-door-triage/SKILL.md) — five P0 categories
- [`deep-read-issue`](../../.claude/skills/deep-read-issue/SKILL.md) — subagent for issue + fix-PR depth
- [`enrich-reporter`](../../.claude/skills/enrich-reporter/SKILL.md) — `gh api users/<login>` enterprise enrichment
- [`enterprise`](../../.claude/skills/enterprise/SKILL.md) — Enterprise Surfaces + Reporters with prior-week trend
- [`topic-search`](../../.claude/skills/topic-search/SKILL.md) — generic cross-repo lookup
- [`slack-tldr`](../../.claude/skills/slack-tldr/SKILL.md) — locked Slack JSON payload format

## Migration map (skill → Outpost native)

| Skill / artifact | Outpost target | Notes |
|---|---|---|
| `weekly-report` orchestrator | `packages/outpost/queue/src/handlers/community-report-weekly.ts` | New job type `COMMUNITY_REPORT_WEEKLY`. Cron Fri 23:00 UTC fan-out per `Community` row. |
| Subagent flow (Discord pull, GitHub pull) | Already in `apps/discord-bot` + `apps/github-app` | Both ingest into existing tables. Native job queries DB instead of re-pulling. |
| `front-door-triage` classification | `packages/outpost/ai/src/front-door.ts` | Five categories as TS enum + classifier. Threshold-skip override stays as a deterministic post-step. |
| `deep-read-issue` subagent | `packages/outpost/ai/src/deep-read.ts` | Calls `gh issue view --comments` + `gh pr diff` via existing GitHub client. |
| `enrich-reporter` (`gh api users/<login>`) | `packages/outpost/ai/src/enrich-reporter.ts` (or `shared`) | 30-day cache via `User.enrichedAt`. Extend `User` with `company` / `companySource` / `bio` / `blog` / `twitterUsername`. |
| `enterprise` surfaces + reporters | `packages/outpost/ai/src/enterprise.ts` + dashboard route | Surfaces table is static config; reporter trend is a query over prior `CommunityReport`. |
| `topic-search` | `apps/web/src/app/reports/community/search` route | Optional v1.5. |
| `slack-tldr` JSON format | `apps/slack-bot/src/lib/post-community-report.ts` | Locked format in the skill file. Posts to `Community.slackChannelId`. |
| Notion page composition (orchestrator step 10) | Dashboard renders natively in Next.js | Optional Notion mirror as side-effect if `Community.notionParentPageId` is set. |
| Notion-specific markdown gotchas | n/a after cutover | Toggle headings, XML tables, forum-thread URL format — all Notion-specific. Dashboard uses React components. |

## Schema notes (relevant existing models)

Existing tables that the spec piggybacks on rather than replacing:

- `User` — `externalId` already holds Discord ID **or** GitHub login. Extend with `company`, `companySource`, `companyEnrichedAt`, `bio`, `blog`, `twitterUsername`.
- `Account` — already the company aggregation entity (`name`, `domain`, `sentiment`, `engagement`, `acv`).
- `Ticket` — already ingests Discord threads + GitHub issues by source (`TicketSource` enum). `CommunitySignalSource` joins to `Ticket.id`.

Net-new tables per [#66](https://github.com/CopilotKit/outpost/issues/66): `Community`, `CommunityReport`, `CommunitySignal`, `CommunitySignalSource`.

## Reference reports (fidelity target for dashboard detail view)

- [Weekly Community Signal — May 26-Jun 08, 2026](https://www.notion.so/3783aa38185281e29b0edc64a20e3fdf) (main) + [AG-UI sub-page](https://www.notion.so/3793aa381852818f8f07d986dcf7830d) — current shape with dual-community + collapsibles.
- [Community Issues — May 17-24, 2026](https://www.notion.so/36c3aa3818528147b720c2d33e0e9bd8) — earlier shape before the demand/pain reframe.

## Open decisions for engineering

Tracked on [#66](https://github.com/CopilotKit/outpost/issues/66) + the [Notion handoff page](https://www.notion.so/37a3aa3818528152a275d6c817d5a28c).

1. **Deterministic vs AI clustering for v1?** Recommend deterministic (title similarity + source-ref overlap). The manual routine clusters fine without a model.
2. **Notion mirror in v1 or v1.5?** Recommend v1.5.
3. **Fuzzy identity match in v1 or v2?** Recommend v2; ship exact-handle + email match in v1.
4. **Window-of-record for `carryover open`?** Recommend "while the GitHub issue is OPEN."
5. **Bird's-eye view: aggregate cross-community patterns, or siloed?** Recommend siloed for v1.
6. **Cron vs interval scheduler?** Current scheduler is `setInterval`-only. Recommend adding `cronExpression` to `ScheduledJobDefinition` via `node-cron` so Fri 23:00 UTC works cleanly.

## Coordination

- Workflow source-of-truth lives in [`NathanTarbert/mcp-discord`](https://github.com/NathanTarbert/mcp-discord). Spec changes land there first; the skill files here mirror that source.
- Manual routine continues running until the Outpost dashboard ships the Weekly Community Signal report.
- After cutover, the skill suite becomes a reference / fallback path. Spec changes still land in the skill files first.
- Open to walking through any skill or format detail with whoever picks up the build.
