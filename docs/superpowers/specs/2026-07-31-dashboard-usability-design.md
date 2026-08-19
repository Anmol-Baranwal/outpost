# Dashboard usability — trend filter, Needs Human Reply, FAQ

**Date:** 2026-07-31
**Status:** approved, not yet implemented
**Author:** Nathan Tarbert (design), Claude (drafting)

## Problem

The dashboard at `/dashboard` renders four things. Three of them are wrong or dead:

1. **Tickets Trend** is hardcoded to the current month with no way to look back (`apps/web/src/app/api/dashboard/stats/route.ts:19-23`). Its "total tickets" figure is an all-time count displayed under a single month's label, so the number and the chart describe different windows.
2. **SLA Breaches** reads 51 against 51 total tickets. The `SLA_CHECK` job marks an open ticket as resolution-breached once elapsed time passes the target (`packages/outpost/shared/src/sla/checker.ts:80`), and the HIGH target is 480 minutes. Every OSS community ticket is older than eight hours, so everything is flagged. `slaBreachedAt` is also write-once — never cleared when a ticket gets answered — and the card counts all-time while the chart beside it counts one month.
3. **My Tasks** lists tickets where `assigneeId` equals the viewer's member id (`apps/web/src/app/api/dashboard/my-tasks/route.ts:32`). 45 of 51 tickets have no assignee and none are the viewer's, so the panel always reads "All caught up".
4. **Frequently Asked** reads `PATHFINDER_MCP_URL`, which is unset, and returns an empty list (`apps/web/src/app/api/dashboard/faq/route.ts:18`). No FAQ model or generation job exists anywhere in the repo, so the empty-state copy — "FAQs are automatically generated from support conversations" — describes a feature that was never built.

Result: a landing page that tells the operator nothing actionable.

## Out of scope

**Per-customer contractual SLAs.** SLA targets should become a per-`Account` setting that sales edits from the customer page, sourced from that customer's contract, replacing the global per-priority map in `packages/outpost/shared/src/constants.ts`. That is a separate feature, tracked in §8 Sales of the [Outpost Roadmap & Status](https://app.notion.com/p/3a03aa381852818f87c1c37af9032f6f) Notion page. Until it lands, the SLA Breaches card is repurposed (PR 2 below) rather than patched. When it does land, that work must also clear `slaBreachedAt` on response and scope the count to the dashboard's selected month.

Outpost is intended to serve sales as well as support once usable. Nothing sales-specific is built here; the constraint is only that these three surfaces avoid baking in support-only assumptions.

## Deliverables

Three independently shippable PRs, in order.

---

## PR 1 — Tickets Trend month filter

### API

`GET /api/dashboard/stats?month=YYYY-MM`. Omitted, malformed, or out-of-range values fall back to the current month rather than returning an error — a bad query param should not blank the dashboard.

The month window is derived from the param instead of `new Date()`. Response gains:

- `availableMonths: string[]` — every `YYYY-MM` from the oldest ticket's `createdAt` through the current month, so the dropdown offers only months that can contain data. Costs one `min(createdAt)` aggregate.
- `totalTickets` changes meaning: the **selected month's** count, not all-time. The all-time count is dropped; nothing else consumes it.

`slaBreaches` stays in this response for now. PR 1 must not break the SLA card while it is still on screen — the field is removed in PR 2, together with the card that reads it.

### UI

`TicketsTrend` gains a month `<select>` in its header, populated from `availableMonths` and labelled "July 2026" style. The dashboard page owns the selected month and refetches on change. The existing empty state ("No ticket data for this period") already covers months with no tickets.

### Tests

- Month-window math: first/last day boundaries, month lengths, year rollover (December → January).
- Param validation: `2026-07` accepted; `garbage`, `2026-13`, a month before the first ticket, and a future month all fall back to the current month.
- `availableMonths` spans oldest ticket → now with no gaps.
- `totalTickets` reflects the selected month, not all tickets.

---

## PR 2 — Needs Human Reply

Replaces both the My Tasks panel and the SLA Breaches card.

### Definition

A ticket qualifies when **all** hold:

- it has at least one AI message (`type = BOT AND isAiGenerated = true`);
- no message with `authorType = TEAM` exists with `createdAt` later than the newest AI message;
- status is not CLOSED or RESOLVED.

A reply from the reporter does **not** clear a ticket from the list. An unanswered "that didn't work" is the case most in need of attention, so only a team member's reply removes it. On the 2026-07-31 prod snapshot this yields 50 of 51 tickets: all 51 received an AI reply, and only `TKT-AD8S9CHR` has any reply since, from a team member.

### Schema

`Message` gains:

- `authorType` — enum `MessageAuthorType`: `TEAM` | `COMMUNITY` | `AI` | `SYSTEM`. Nullable during backfill, then required.
- `userId` — nullable FK to `User`.
- index on `(ticketId, authorType, createdAt)`.

This is needed because a team reply and a community reply are currently indistinguishable: both are stored as `type = USER` with `author` as a display string (`"NathanTarbert (66887028)"` vs `"nagasatish007 (25077064)"`), and `Message` has no relation to `User` or `TeamMember`.

`InboundHandler` already calls `isTeamMember` for every inbound reply (`packages/outpost/shared/src/platforms/inbound.ts:189`, `:242`) and discards the result. It now persists it, along with the `userId` it resolves via `findOrCreateUser`.

### Backfill

A script in `scripts/` parses the `"name (externalId)"` suffix of each existing message, resolves `User` → `TeamMember` by email, and sets `authorType` accordingly. AI-generated messages become `AI`, `type = SYSTEM` rows become `SYSTEM`.

Rows whose author string cannot be parsed or resolved are **reported, not defaulted** — silently marking an unresolvable author as `COMMUNITY` would fabricate the exact signal this feature reads. The script prints a per-row summary and a final count so any residue is a visible decision.

### Surfaces

`GET /api/dashboard/needs-human-reply` → `{ count, tickets[] }`, with an optional `source` filter (`DISCORD`, `GITHUB_ISSUE`, `GITHUB_DISCUSSION`). Each ticket carries displayId, title, source, reporter, `createdAt`, and the timestamp of the last activity.

- The My Tasks panel becomes **Needs Human Reply** in the same slot: ticket, source badge, reporter, age, last activity, linking to the ticket detail. Its filter switches from status to source, since status no longer varies meaningfully across the list.
- The third stat card swaps SLA Breaches for this count.
- `Avg Resolution Time` renders `—` when no ticket has ever been RESOLVED or CLOSED, instead of `0 sec`. A real zero and no-data currently look identical, and today it is always no-data.

Assignment is unaffected and still happens from the ticket sidebar (`apps/web/src/components/tickets/ticket-sidebar.tsx:204`).

### Adjacent data bug

`TeamMember.name` is empty for `nathan@copilotkit.ai` in production, so that member renders as a blank option in the assignee dropdown. Two fixes: set the name in prod, and have the UI fall back to email when `name` is empty.

### Tests

- Qualifying query: AI reply with no follow-up qualifies; AI reply then team reply does not; AI reply then reporter reply **does**; AI reply then reporter then team does not; no AI reply never qualifies; CLOSED/RESOLVED excluded.
- Ordering by AI-reply age, oldest first.
- Backfill parser: team author, community author, AI message, system message, unparseable author (reported, left null).
- `InboundHandler` persists `authorType` and `userId` for both team and community senders, on new tickets and replies.
- Source filter.
- `—` rendering when no resolution data exists.

---

## PR 3 — FAQ generation

### Corpus

Recurring questions across **all** tickets regardless of status. Not resolved-only: no ticket has ever been marked RESOLVED or CLOSED, so a resolved-only corpus renders the same blank panel with more machinery behind it. Not positive-feedback-only either: of 68 AI messages almost none carry feedback yet.

### Clustering

Claude directly, no embeddings. The job sends the title and first message of the most recent N tickets (N capped at 200) in one call and asks for groups of 2+ tickets asking the same underlying question, then generates a canonical question and answer per group, drawing on the AI replies those tickets already received.

Outpost's schema has no embedding column and no vector infrastructure — the pgvector Docker image in `docker-compose.yml` serves Pathfinder's separate knowledge-base database, not Outpost's. Embeddings plus pgvector is the right answer at 10k tickets. At 51, one Claude call is cheaper, simpler, and needs no migration. The 200-cap is the point at which that reasoning should be revisited.

### Model

`Faq`: `id`, `question`, `answer`, `status` (`DRAFT` | `PUBLISHED` | `DISCARDED`), `clusterSize`, `sourceTicketIds` (Json), `reviewedBy`, `reviewedAt`, `createdAt`, `updatedAt`.

### Job

`FAQ_GENERATE`, added to `JobType` (`packages/outpost/queue/src/types.ts:12`) and registered on the weekly scheduler. It writes DRAFT rows and never modifies rows already PUBLISHED or DISCARDED, so a re-run cannot overwrite a human decision. Re-clustering an already-covered question produces no new draft.

### Review flow

- `GET /api/dashboard/faq` returns PUBLISHED only, replacing the current Pathfinder implementation. The panel is trustworthy by construction — an AI-written wrong answer cannot appear on the dashboard without a human promoting it.
- Admins see a drafts view on the same panel with promote/discard, patching `/api/faq/[id]`. Role-gated to ADMIN.
- Empty-state copy is rewritten to describe actual behaviour.

### Tests

- Cluster-response parsing, including a malformed model response (job fails loudly rather than writing garbage drafts).
- A generation run never mutates PUBLISHED or DISCARDED rows.
- Clusters below the 2-ticket floor produce no draft.
- The dashboard endpoint excludes DRAFT and DISCARDED.
- Promote/discard transitions, and rejection of non-admin callers.
- The 200-ticket cap is applied to the newest tickets.

---

## Verification

Each PR is verified against the prod-data clone on `localhost:5433` (pg18 container `outpost-pg18-prodclone`, restored from a 2026-07-31 `pg_dump` of production), not against seed data. Expected results on that snapshot:

- PR 1: June 2026 and July 2026 both selectable; July shows 47, June shows 4 (oldest ticket is 2026-06-04; the two months sum to the 51 all-time total).
- PR 2: panel opens with 50 tickets; `TKT-AD8S9CHR` is absent.
- PR 3: at least one draft cluster from the repeated threads/persistence and Python SDK reports; the panel stays empty until a draft is promoted.
