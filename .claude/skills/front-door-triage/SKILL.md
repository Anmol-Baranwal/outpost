---
name: front-door-triage
description: P0 classification rules for community reports. Six categories that auto-headline regardless of reporter count. Reference doc — invoked by weekly-report when classifying.
---

# Front-door triage

**Front-door** = anything that blocks a new user from getting CopilotKit running, blocks an existing user from a core integration surface, or breaks the auth/login flow.

**1 report = P0 = headline.** Single report enough. Skip the demand/pain threshold rule. Front-door P0s + current-release outages feed the cross-community **🔝 Top issues of the week** (the report's lead) — never demoted to Early signals. The six categories below decide what's *eligible*; the **ranking rubric** decides the *order*.

## Six categories

### 1. 🚨 Quickstart broken

Any integration quickstart fails on first run. Includes:

- Next.js / Express / Node standalone runtime quickstart 404s or runtime errors
- LangGraph / ADK / AGUI / A2UI / Pydantic / Mastra / DeepAgents / LlamaIndex / AWS Strands / Agno / agent-spec quickstart docs broken
- `pnpm install` / `pnpm dev` first-run failure
- Missing or wrong import paths in quickstart code blocks (e.g. `react-ui/v2/styles.css` instead of `react-core/v2/styles.css`)
- Doc URLs in quickstart that 404

### 2. 🚨 Agent framework integration broken

LangChain / LangGraph / CrewAI / PydanticAI / ADK / Mastra / AGUI / A2UI adapter surface broken. Includes:

- Filter / whitelist bugs (e.g. `emit_tool_calls`)
- State-sync gaps, snapshot leaks, hook regressions
- Adapter import / shape / contract drift
- Tool-call rendering not painting under `useAgent` / `useComponent` / `useRenderTool`

### 3. 🚨 Example code broken

Repo examples (`CopilotKit/examples/*`), live demos (`copilotkit.ai/use-cases/*`), showcase apps, **the Dojo**, docs sample code that doesn't run. Includes:

- **Dojo / showcase broken** — any bug a reporter says is "replicated in Dojo" or "happens in the showcase / live demo" auto-promotes to front-door P0 regardless of bug size. Dojo is the official demo surface; broken Dojo = broken front door.
- Broken GitHub links under live demo pages
- Sample code in docs that throws on copy-paste
- Showcase apps that 500 / blank-screen
- Stale `npx copilotkit@latest create -f <template>` templates that no longer exist

### 4. 🚨 Auth / security blocker on runtime surface

CSRF / Authorization / license-verifier / token-flow bugs that block production deploy. Includes:

- Headers dropped on `/threads` or other v2 runtime routes (X-CSRF, Authorization, custom validation headers)
- License verifier rejecting valid tokens at runtime
- Token-flow breakage in `<CopilotKit>` provider props
- CORS / preflight bugs on documented endpoints

### 5. 🚨 CLI + license/login flow broken

`npx copilotkit@latest *` subcommand failure OR the associated login/license flow. Includes:

- `npx copilotkit@latest create` / `license` / any subcommand throws or returns wrong artifact
- License token generation flow broken
- License verifier rejecting valid tokens (overlaps with #4 when triggered at runtime)
- Sign-in / auth handshake errors during onboarding
- Env-var handling for `COPILOT_CLOUD_PUBLIC_API_KEY` etc broken
- CLI templates referenced in docs / examples that don't exist anymore

### 6. 🚨 Severe crash / data-loss / error-handling break

A bug that **crashes** the agent/runtime, **loses or corrupts data**, or **breaks the error-handling path itself** — Top-issue eligible even when it isn't a "front door." Don't park these in Pain. Strongest when the reporter supplies a solid repro. Includes:

- Unhandled crash on a common runtime path — `TypeError` / null-deref in `runAgent` / `connectAgent` / event processing / subscribers.
- **A crash *inside* the error path** — e.g. the `onRunError` / error-subscriber callback itself throws, masking the real failure. Doubly bad: the safety net fails and hides the root cause.
- Data loss / corruption / silent message drops.
- Severity is the trigger here, not surface — a clean, well-reproduced crash beats a vague front-door mention.

Precedent: `ag-ui#1961` — null/undefined `messages` crashes 7 call sites including the `onRunErrorEvent` subscriber, thorough repro → elevated to an AG-UI Top issue instead of being parked in Pain (the agent had missed it).

## Classification rules

**Don't infer "broken" from "unclear" or "missing".** A reporter asking *"where can I find sample code for X?"* is reporting that **a link needs to be updated** or a docs path needs to be published — not that something is broken. Quote the reporter's wording. If they didn't say something errored, threw, 404'd, crashed, or returned wrong output, don't write "broken". Use neutral language: *"the link points at X and needs to be updated to Y"*.

**However: surface matters.** If the wrong link / unpublished example lives on a front-door surface — marketing pages on `copilotkit.ai`, the Dojo, official quickstart docs, repo README, `npx copilotkit@latest create` templates — it still surfaces in 🚨 Front-door flags even with the neutral wording. The criterion is *where* the issue lives, not whether the reporter said "broken".

**Multiple categories on one report:** tag with the most-blocking category. Note overlap inline ("Also a CLI flow break — see #5").

**Rich-repro badge.** When a report includes YouTube / Loom / screen recording, a public repro repo, or a working sandbox link, append `📹 **Rich repro**` to the entry and quote the media URL inline. Triage cost is low when repro is one click away.

**Internal Slack reference.** If the team flagged the same issue in Slack, add `**Reported in Slack:** [<channel> thread](slack-url)` bullet. Signals engineering already has internal visibility.

## Ranking the Top issues of the week

The lead section is **ranked**, cross-community. Ranking is a **score, not a vote** — community (CK vs AG-UI) is NOT an axis. An AG-UI issue outranks a CopilotKit one only when it scores higher. Score each candidate on five axes, sum, sort descending. **Tie-break order:** Blast radius → still-open-before-resolved → Surface tier. (A still-broken issue edges a same-day-fixed one at a tie — it's the open wound.)

| Axis | Measures | Scale |
|---|---|---|
| **Surface tier** | where in the funnel it sits | install/quickstart CLI **or** current-release outage = **5** · auth/security blocker **or** error-path break / data-loss crash = **4** · core feature broken **or** severe crash (cat. 6) = **3** · docs-landing = **3** · edge/config = **1** |
| **Blast radius** | who actually hits it | default path / all users = **5** · large segment = **3** · narrow = **1** |
| **Severity** | is there a workaround | fully broken, none = **3** · workaround exists = **2** · cosmetic = **1** |
| **Exposure** | duration / how it shipped | still broken >1 month = **+2** · still broken on the current release = **+2** · shipped-broken but fixed same day = **+1** |
| **Signal** | who's reporting | enterprise current-company **or** ≥2 distinct reporters = **+1–2** |

**Fix status is a tag, not a demotion.** A fixed-same-day outage still headlines as news — it just carries the ✅; it doesn't drop in rank.

### Measurable inputs (compute the score, don't guess)

Each axis is backed by data the scoring step pulls — the rank must be defensible:

- `gh issue view <n> --json reactionGroups,comments` → 👍 count + comment count → **Blast radius** proxy.
- `gh issue view <n> --json labels` → maintainer-set severity/priority → **Severity**.
- Fix-PR detection (orchestrator step 9) → fix status + whether it shipped → **Exposure** + the ✅ tag.
- Discord distinct-reporter count + reactions → **Blast radius** / **Signal**.
- `enrich-reporter` → enterprise current-company → **Signal**.
- Issue `createdAt` vs now (and "broken since" from comments) → **Exposure**.

### Output

The scoring step returns a table — `candidate | surface | blast | severity | exposure | signal | TOTAL` — sorted. The top 3–5 become the Top issues. **Publish the rubric + this run's scores** in the report's bottom "📊 Top-issue ranking" child page so the order is auditable, not asserted.

### Priority from rank (H/M/L on every card)

Every Top-issue (and 🏢 Enterprise question) card carries a **Priority** band, **derived from the same TOTAL score** so it's defensible, not a vibe. Bucket the TOTAL:

- 🔴 **High** — TOTAL ≥ 12, **or** any front-door P0 on the current release / a current-release outage, **or** category 6 (severe crash / data-loss). The "drop everything" tier.
- 🟡 **Medium** — TOTAL 7–11. Real, scheduled, not on fire.
- 🟢 **Low** — TOTAL ≤ 6. Track it; no urgency.

The band is the **default** — Nathan can override by hand on any card (an enterprise reporter or a known-strategic surface can bump a Medium to High). When overridden, that's fine; the rank table still shows the computed score so the override is visible. **Owner is always blank** for manual assignment (never auto-named).

## Rendering

- **Section header:** `**N active this week.**` and stop. No methodology recap. Methodology lives at the bottom of the page.
- **Entry titles:** specific, neutral wording — name the function/file/symptom. E.g. `🚨 LangGraph emit_tool_calls filter not working`, `🚨 /threads drops Authorization header`, `🚨 co-creation-copilot demo link points at monorepo`. Avoid generic "X broken" titles.
- **Toggle heading per entry:** `### 🚨 <symptom> {toggle="true"}` with body bullets tab-indented:
  - **Reporter:** linked + date + version
  - **Symptom:** one or two sentences with quoted technical detail
  - **Fix PR:** linked + status, or "None yet."
  - **Owner:** _<blank — Nathan fills>_ · **Priority:** 🔴 High / 🟡 Medium / 🟢 Low (derived from TOTAL, see "Priority from rank")
  - **Action:** one-line next step
  - **Rich repro:** 📹 [link] (if applicable)
  - **Reported in Slack:** [channel thread] (if applicable)
- **Demotion:** once resolved (fix merged + reporter confirmed, or doc backfilled), move to `### ✅ Resolved this week` and out of Front-door. Apply **immediately** if resolved pre-publish — decrement the count, drop the matching Gaps item, update the TL;DR.
