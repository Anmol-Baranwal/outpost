---
name: enterprise
description: Enterprise-specific view across CopilotKit + AG-UI. "Enterprise" here = CopilotKit's COMMERCIAL surfaces (Premium / CopilotKit Enterprise / Intelligence Platform / paid tiers), NOT CopilotKit running inside a big company. Tracks the commercial product surfaces (from product-surface-scan — Enterprise Intelligence, Cloud, self-host license, threads/persistence tier, Inspector, premium UI/Angular SDK, analytics, security bundle, Slack/Teams), applies the free-vs-paid classifier to decide if an issue belongs here, surfaces cross-page product contradictions, and tracks enterprise questions/complaints, community-sourced prospects (with a sales owner), and enterprise reporters with prior-week trend. Elevated to the top of the weekly report. Runs standalone ("who's at enterprise this week") or invoked by weekly-report. Triggers on "enterprise report", "enterprise signals", "enterprise status", "who at enterprise this week".
---

# Enterprise signals

**What "Enterprise" means here (scope — read first).** This section is about **CopilotKit's commercial product surfaces** — anything sold as **Premium**, **CopilotKit Enterprise**, the **Intelligence Platform** (Enterprise Intelligence), **CopilotKit Cloud**, or gated behind a paid tier / license key. It is **NOT** "CopilotKit running inside an enterprise company." A bug in a free, open-source path used by a Fortune 500 is a normal community issue (Pain/Demand), **not** Enterprise. An item lands in 🏢 Enterprise only when it **hits a commercial surface**. Note a feature can be **free-but-limited AND commercial** — threads/persistence is free up to a cap, then Premium (that's why a paid-persistence complaint IS enterprise). The authoritative surface list + the free-vs-paid classifier are produced each week by the **`product-surface-scan`** skill — use its output, not a memorized list. (Precedent: agno AgentOS auth `ag-ui#2130` was mis-filed here — it's a third-party framework's endpoint auth on the OSS dojo integration, not a CopilotKit commercial surface → it belongs in Demand.)

Two purposes:

1. **Track the enterprise surfaces** — the commercial product paths (from `product-surface-scan`) and their status this week.
2. **Track enterprise reporters** — GitHub authors with company affiliations, with prior-week trend.

Can run **standalone** (just the enterprise view, no full weekly report) or **inline** as a subsection of the weekly report.

## Enterprise surfaces (tracked every week)

**The surface list comes from `product-surface-scan`** (run at report start), not a hardcoded list — features get added and tiers get redrawn, so refresh it each week. Render the scan's current surfaces as a Notion XML table:

| Surface | Status this week | Detail |
|---|---|---|
| **Enterprise Intelligence Platform** (durable threads, persistence, hosted inspection, analytics, learning) | 🚨 BROKEN / FR open / OK — no reports / unknown | one-line, linked to underlying issue/PR if any |
| **CopilotKit Cloud** (managed hosting, project API key, sign-in/console) | ditto | |
| **Self-Hosted Enterprise Intelligence** (license key, `copilot-intelligence` Helm chart) | ditto | |
| **Threads & Persistence** (retention window, max-thread cap, resume/replay) | ditto | |
| **CopilotKit Inspector** (monitoring, replay, tracing) | ditto | |
| **Premium UI components** (Fully Headless Chat UI, Angular SDK) | ditto | |
| **Analytics & Self-Learning** (dashboards, lakehouse, OTLP, in-context RL) | ditto | |
| **Security bundle** (SOC 2, SSO / RBAC, offline licensing) | ditto | |
| **Support / SLA** (dedicated Slack, SLA, priority fixes) | ditto | |
| **Slack & Teams integrations** (agentic UI deployed into Slack/Teams) | ditto | |

**Default cell** for a surface with no in-window reports: `OK — no reports`. Surfaces are persistent — render every week even if all OK. Absence of reports IS a signal.

## The classifier — does an issue belong in 🏢 Enterprise?

Apply the `product-surface-scan` classifier to every candidate. **YES** if it touches: threads/persistence (esp. the paid cap/retention/replay), Inspector, Cloud hosting / project API keys, self-host license keys / Helm, SSO/RBAC/SOC 2, Analytics/Self-Learning, the Fully Headless Chat UI or Angular SDK, Slack/Teams deployment, or a pricing/licensing/"is X Premium?" question. **NO** (→ Pain/Demand) for pure OSS usage under the free caps — React SDK, AG-UI protocol, backend/framework connections, a third-party integration's own auth — **even when the reporter works at a large company.**

## ⚠️ Product surface contradictions (from `product-surface-scan`)

`product-surface-scan` also compares the product/pricing/premium pages against each other. If it finds a contradiction (a cap/price/free-vs-premium/OSS-vs-Enterprise/availability claim that conflicts between pages, or a page-vs-maintainer conflict), the report carries a **`## ⚠️ Product surface contradictions`** category **near the top (under 🔝 Top issues, above 🏢 Enterprise)** — one card per contradiction with both quoted claims + both page links + a suggested source of truth, so product can fix the pages. When there are none, render a single quiet line in this section: *"Product pages checked for contradictions — none this week."* + the referenced page list.

## Enterprise reporters

**Prior-week comparison line** at the top of the subsection. Format:

```
**N in actionable clusters this week** · **prior week: M** (<reporter (linked) 🏢 Company> · ...) · **trend ↑/↓/→**
```

Compute prior-week count by re-running enrichment over the prior 7-day window:

```bash
gh issue list --repo CopilotKit/CopilotKit --state all --search "created:<prev_start>..<prev_end>" --json author
gh issue list --repo ag-ui-protocol/ag-ui --state all --search "created:<prev_start>..<prev_end>" --json author
```

Then enrich via `enrich-reporter` skill.

Below the trend line: one bullet per company.

```
- [`<login>`](github-url) 🏢 **<Company>** — filed [#NNNN](issue-url) (cluster: <top pain / top demand / resolved / community ops>)
```

**Headline call-out** if the pattern is decision-relevant:

```
> **Headline:** Enterprise users concentrated in top pain (3 of 4 reporters filed against /threads auth surface) — flag to sales/CS.
```

If no enterprise reporters this week, render the section with prior-week trend line still computed:

```
**0 in actionable clusters this week** · **prior week: M** (...) · **trend ↓**
```

## Enterprise questions & complaints (highlighted, top of section)

In the weekly report the 🏢 Enterprise section is **elevated to the top of the main page** (under 🔝 Top issues, above the community body) and **leads with `### 🚩 Enterprise questions & complaints`** — the catch-all for **any question or complaint touching an enterprise surface or the enterprise offering**, gathered across GitHub + Discord + Slack so nothing enterprise hides in the general body.

- **The threads / persistence ("enterprise threads") tier is enterprise by definition.** A complaint about paying for threads, the persistence tier, or self-host runtime ownership belongs here — not just buried in Pain. (Precedent: the "threads off" / paid-persistence friction is an enterprise complaint, surfaced here.)
- Each item is a **card** (What / Impact / Fix plan) **plus an Owner + Priority meta line** — `**Owner:** _<blank>_ · **Priority:** 🔴/🟡/🟢` (owner blank for manual assignment; priority derived from rank — see `front-door-triage`).
- Already a Top issue? List here with a one-line pointer ("see Top issue #N"), don't duplicate the card.
- None this week → say so explicitly.

## Prospective enterprise customers (community-sourced)

A standing subsection (`### 🎯 Prospective enterprise customers`) naming **community members who look like enterprise prospects** — a lead list from the wild, distinct from "Companies building on us" (confirmed current-employer signal).

- **Qualifies:** active in Discord/GitHub/Reddit, company is a recognizable enterprise / well-funded scale-up evaluating or building on us (e.g. **Jasper AI**). Judge by company + engagement depth + use case. When unsure, include with "(worth a look)".
- **A current employee of a recognizable enterprise (especially a hyperscaler / large company) who CONTRIBUTES fixes or builds on our integration is HIGH-INTENT — list them as a prospect, do NOT dismiss them as "just an ecosystem contributor."** An AWS / Google / Microsoft / etc. engineer filing and fixing an adapter bug for our protocol means that company is actively investing in interop with us — that's an adoption signal sales wants, not noise. A code contribution counts as much as an eval. Include them even when LinkedIn can't be confirmed (mark `LinkedIn not confirmed`) — the confirmed current employer + the contribution are enough. (Precedent: `FriedhelmWS` @ AWS filed + fixed the AG-UI Strands adapter bugs `#2121`/`#2129` → high-intent prospect, not merely "companies building on us.")
- **Deep-enrich each prospect via the `enrich-prospect` subagent** — finds the LinkedIn profile (employer verified against the GitHub company; keeps searching on a mismatch, never guesses), company website, and company size (ARR / latest funding round / employee count). Deep pass on the shortlist only.
- **COLLAPSIBLE toggle heading, company-first** (from `enrich-prospect`): `### 🎯 Prospective enterprise customers {toggle="true"}` with every block tab-indented to nest inside (whole list collapses to one line). Author with REAL newlines + REAL tabs (not `\n`/`\t`).
  ```
  ### 🎯 Prospective enterprise customers {toggle="true"}
  	- **Company:** [<Company>](<company website url>)
  		**Name:** [<Full Name>](<LinkedIn url>)          ← or "<Full Name> — LinkedIn not confirmed"
  		**Issue:** [<GitHub issue title>](<issue url>)   ← **Source:** [<thread/post>](<url>) for Discord/Reddit
  		**Company Details:** <ARR / latest funding round only / employee count — most-recent only, or "size unknown">
  		**Passed to (sales):** _<blank — Nathan fills>_
  ```
- **`Passed to (sales):` is a blank owner field** — Nathan tags whoever on sales he handed the lead to; never auto-named.
- **Identity accuracy over completeness:** unconfirmed LinkedIn → `LinkedIn not confirmed`, never a guess; never fabricate a size figure.
- **Source link mandatory** (the `Issue:` / `Source:` link). None this week → "No new community-sourced enterprise prospects this week."

## When to flag

- **Enterprise reporter in top pain or top demand cluster** — call out explicitly in the Highlights section ("both are in the top pain cluster").
- **Enterprise surface marked BROKEN** — promote to Highlights bullet.
- **High-volume undeclared reporter** (no public affiliation but technical depth suggests undeclared enterprise engineer) — surface as a 🎯 Prospective enterprise customer ("worth a cold outreach").

## Cross-references

- `enrich-reporter` — actually does the `gh api users/<login>` lookups (shallow, all reporters)
- `enrich-prospect` — deep prospect enrichment (LinkedIn + company website + size) for the 🎯 Prospective enterprise customers list
- `front-door-triage` — many enterprise surface issues will also match a front-door category
- `weekly-report` — invokes this skill for the 🏢 Enterprise section

## Standalone mode

When invoked outside the weekly routine ("enterprise report this week" / "who at enterprise this week"):

1. Pull GitHub issues for the named window from both repos
2. Enrich every author via `enrich-reporter`
3. Render Surfaces table + Reporters subsection
4. Skip the rest of the weekly report scaffolding

Output: a short Notion page (or just chat reply) with the same Surfaces table + Reporters subsection, scoped to the asked window.
