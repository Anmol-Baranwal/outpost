---
name: front-door-triage
description: P0 classification rules for community reports. Five categories that auto-headline regardless of reporter count. Reference doc — invoked by weekly-report when classifying.
---

# Front-door triage

**Front-door** = anything that blocks a new user from getting CopilotKit running, blocks an existing user from a core integration surface, or breaks the auth/login flow.

**1 report = P0 = headline.** Single report enough. Skip the demand/pain threshold rule. Surface in the dedicated `### 🚨 Front-door flags` section under the affected community, never demoted to Early signals.

## Five categories

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

## Classification rules

**Don't infer "broken" from "unclear" or "missing".** A reporter asking *"where can I find sample code for X?"* is reporting that **a link needs to be updated** or a docs path needs to be published — not that something is broken. Quote the reporter's wording. If they didn't say something errored, threw, 404'd, crashed, or returned wrong output, don't write "broken". Use neutral language: *"the link points at X and needs to be updated to Y"*.

**However: surface matters.** If the wrong link / unpublished example lives on a front-door surface — marketing pages on `copilotkit.ai`, the Dojo, official quickstart docs, repo README, `npx copilotkit@latest create` templates — it still surfaces in 🚨 Front-door flags even with the neutral wording. The criterion is *where* the issue lives, not whether the reporter said "broken".

**Multiple categories on one report:** tag with the most-blocking category. Note overlap inline ("Also a CLI flow break — see #5").

**Rich-repro badge.** When a report includes YouTube / Loom / screen recording, a public repro repo, or a working sandbox link, append `📹 **Rich repro**` to the entry and quote the media URL inline. Triage cost is low when repro is one click away.

**Internal Slack reference.** If the team flagged the same issue in Slack, add `**Reported in Slack:** [<channel> thread](slack-url)` bullet. Signals engineering already has internal visibility.

## Rendering

- **Section header:** `**N active this week.**` and stop. No methodology recap. Methodology lives at the bottom of the page.
- **Entry titles:** specific, neutral wording — name the function/file/symptom. E.g. `🚨 LangGraph emit_tool_calls filter not working`, `🚨 /threads drops Authorization header`, `🚨 co-creation-copilot demo link points at monorepo`. Avoid generic "X broken" titles.
- **Toggle heading per entry:** `### 🚨 <symptom> {toggle="true"}` with body bullets tab-indented:
  - **Reporter:** linked + date + version
  - **Symptom:** one or two sentences with quoted technical detail
  - **Fix PR:** linked + status, or "None yet."
  - **Action:** one-line next step
  - **Rich repro:** 📹 [link] (if applicable)
  - **Reported in Slack:** [channel thread] (if applicable)
- **Demotion:** once resolved (fix merged + reporter confirmed, or doc backfilled), move to `### ✅ Resolved this week` and out of Front-door. Apply **immediately** if resolved pre-publish — decrement the count, drop the matching Gaps item, update the TL;DR.
