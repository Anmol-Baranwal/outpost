# AI Response Confidence Display + Real Feedback Loop

## Context

The AI agent already posts real responses in Discord and GitHub today (not a stub, not shadow-mode — see issue [#100](https://github.com/CopilotKit/outpost/issues/100) for the full grounding). Two gaps:

1. **Confidence scoring doesn't reflect the actual response.** `ConfidenceScorer` runs in parallel with generation, scoring Pathfinder retrieval quality against a placeholder empty string (`packages/outpost/ai/src/pipeline.ts`) — not the text that actually gets posted. There's no visibility into this number anywhere in the dashboard either.
2. **Feedback is inconsistent between channels.** Discord has a real feedback loop (`apps/discord-bot/src/interactions/buttons.ts` — "Issue Solved" / "Need more help" buttons update ticket status and escalate). GitHub's is fake — the AI's comment asks for a 👍/👎 reaction, but nothing reads it.

## Goals

1. Confidence score reflects the real generated response, not a retrieval-quality proxy.
2. Confidence is visible per-ticket in the dashboard (reusing the existing `ConfidenceBadge` component from the QA feature).
3. GitHub gets a real feedback mechanism, on par with Discord's.
4. Negative feedback (either channel) triggers the same escalation path that already exists.

## Non-goals

- Aggregate confidence/gaps dashboard view (trends over time, worst-scoring topics) — explicitly deferred, follow-up work.
- Reworking `AlertManager` — it's dead code today (never instantiated outside its own test) and this feature doesn't need it; the existing `ESCALATION` job's in-app reassignment is sufficient.
- Blocking posting on low confidence — posting behavior is unchanged (always post, disclaimer + escalate on low confidence).

## Design

### 1. Confidence scoring — score the real response

Today `pipeline.ts` runs generation and confidence scoring in parallel, so the scorer never sees the actual generated text (a code comment in the pipeline admits this: "Response not yet available — scorer focuses on search result quality").

Change to sequential: generate the response first, then score that text. This adds one Claude call in series (latency cost, accepted) in exchange for a confidence number that means "is this answer good," not just "did we find good docs." The heuristic (Pathfinder relevance) and Claude-judged (Haiku) scores stay as the two inputs to `Math.min()` — only the judged score's input changes, from `''` to the real generated text.

Posting behavior is unchanged: still always posts. Below `AI_CONFIDENCE.ESCALATE` (0.4), still adds a disclaimer and enqueues `ESCALATION` — same as today, just now a genuine signal instead of a proxy.

### 2. Data model

Add to `Message` (`packages/outpost/db/prisma/schema.prisma`):

```prisma
model Message {
    // ...existing fields...
    confidenceScore Float?
    confidenceLevel String?  // "HIGH" | "MEDIUM" | "LOW", mirrors ConfidenceLevel
    feedback        String?  // "POSITIVE" | "NEGATIVE" | null (no feedback yet)
}
```

Set on the AI-generated `Message` row at creation time (`ai-response.ts`, where the message is currently persisted with `isAiGenerated: true`). `feedback` starts `null` and gets set later when a human responds (button click, or the GitHub reaction poll).

### 3. Per-ticket display

`apps/web/src/components/qa/confidence-badge.tsx` already renders HIGH/MEDIUM/LOW. Port it into `apps/web/src/components/tickets/conversation-thread.tsx`, rendered next to any message where `isAiGenerated` is true and `confidenceLevel` is set. No new UI component — reuse as-is or with minimal prop changes.

### 4. Discord feedback (unchanged mechanism, new field write)

`apps/discord-bot/src/interactions/buttons.ts` already handles "Issue Solved" / "Need more help" clicks. Add one line to each handler: write `feedback: 'POSITIVE'` (Solved) or `feedback: 'NEGATIVE'` (Need more help) to the relevant `Message` row. The existing status-update and escalation-job behavior is untouched.

### 5. GitHub feedback — periodic poll, not a webhook

GitHub has no webhook event for reactions (confirmed against GitHub's official webhook events docs — `issue_comment` only fires on comment create/edit/delete, never on reactions to it). The only way to detect a reaction is polling `GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions`.

New periodic job, `GITHUB_REACTION_POLL`, following the existing `Scheduler`/`SLA_CHECK` pattern (`packages/outpost/queue/src/handlers/sla-check.ts` is the reference implementation — same periodic-job shape). Runs every 24 hours (confirmed interval).

For each `Message` where `isAiGenerated = true`, `feedback IS NULL`, and the parent `Ticket.source` is `GITHUB_ISSUE`/`GITHUB_DISCUSSION`, and the ticket isn't already resolved/closed:
1. Call the reactions endpoint for that comment (`sourceId`/`TicketExternalLink` already tracks the GitHub comment reference — reuse whatever field currently maps a `Message` to its posted GitHub comment ID).
2. Filter reactions to ONLY the ticket's original reporter (`Ticket.user`/reporter identity — matches Discord's model, where only the thread starter sees the feedback buttons; a reaction from anyone else on the thread doesn't count).
3. If the reporter reacted `+1`: `feedback = 'POSITIVE'`. If `-1`: `feedback = 'NEGATIVE'`, enqueue `ESCALATION` (same as Discord's "Need more help"). Any other reaction content, or no reaction from the reporter: leave `feedback` null, check again next poll.
4. Once `feedback` is set, that message is excluded from future polls (the `feedback IS NULL` filter above) — no need to track "last seen" state separately, since we only care about the reporter's first qualifying reaction ever.

### 6. Negative feedback routing

Both paths (Discord "Need more help" button, GitHub 👎 poll match) enqueue the existing `ESCALATION` job (`packages/outpost/queue/src/handlers/escalation.ts`) — no new escalation mechanism. That handler already reassigns the ticket, updates status, and posts a system message; this feature just adds a second trigger path into the same job.

## Testing

Per repo convention (Vitest, red-green, mocked Prisma):
- `pipeline.ts`: test that the confidence scorer is called with the actual generated response text, not an empty string.
- `conversation-thread.tsx`: test the badge renders for AI messages with a confidence level set, doesn't render otherwise.
- `buttons.ts`: test both button handlers write the correct `feedback` value.
- New `github-reaction-poll.ts` handler: test the reporter-only filter (a non-reporter's reaction is ignored), test `+1`/`-1` mapping, test `ESCALATION` is enqueued only on `-1`, test already-resolved messages are excluded from the query.

## Open items carried to implementation

- Exact field on `Message`/`TicketExternalLink` that maps to the posted GitHub comment ID — needs confirming against current schema before writing the poll job (may already exist via `TicketExternalLink`, needs verification).
- Aggregate gaps view — separate future spec, not part of this one.
