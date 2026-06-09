---
name: enterprise
description: Enterprise-specific view across CopilotKit + AG-UI. Tracks enterprise product surfaces (Enterprise Intelligence, CopilotKit Cloud, License flow, SSO, Self-host runtime, Security disclosure, Billing) and enterprise reporters with prior-week trend. Can run standalone ("who's at enterprise this week") or be invoked by weekly-report. Triggers on "enterprise report", "enterprise signals", "enterprise status", "who at enterprise this week".
---

# Enterprise signals

Two purposes:

1. **Track the enterprise surfaces** — known enterprise-only product paths and their status this week.
2. **Track enterprise reporters** — GitHub authors with company affiliations, with prior-week trend.

Can run **standalone** (just the enterprise view, no full weekly report) or **inline** as a subsection of the weekly report.

## Enterprise surfaces (tracked every week)

Render as a Notion XML table:

| Surface | Status this week | Detail |
|---|---|---|
| **Enterprise Intelligence** (IntelligenceIndicator, license verification, intelligence-mode) | 🚨 BROKEN / FR open / OK — no reports / unknown | one-line, linked to underlying issue/PR if any |
| **CopilotKit Cloud** (auth, dashboard, console, sign-in) | ditto | |
| **License flow / verifier** (`npx copilotkit@latest license`, token gen, runtime verifier) | ditto | |
| **SSO / OAuth** | ditto | |
| **Self-host runtime** (`AgentRunner`, `/threads` headers, custom runners) | ditto | |
| **Security disclosure channel** (security@copilotkit.ai, GitHub PVR) | ditto | |
| **Billing / quota** | ditto | |

**Default cell** for a surface with no in-window reports: `OK — no reports`.

Surfaces are persistent — render every week even if all OK. Absence of reports IS a signal.

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

## When to flag

- **Enterprise reporter in top pain or top demand cluster** — call out explicitly in the Highlights section ("both are in the top pain cluster").
- **Enterprise surface marked BROKEN** — promote to Highlights bullet.
- **High-volume undeclared reporter** (no public affiliation but technical depth suggests undeclared enterprise engineer) — separate "worth a cold outreach" bullet.

## Cross-references

- `enrich-reporter` — actually does the `gh api users/<login>` lookups
- `front-door-triage` — many enterprise surface issues will also match a front-door category
- `weekly-report` — invokes this skill for the 🏢 Enterprise section

## Standalone mode

When invoked outside the weekly routine ("enterprise report this week" / "who at enterprise this week"):

1. Pull GitHub issues for the named window from both repos
2. Enrich every author via `enrich-reporter`
3. Render Surfaces table + Reporters subsection
4. Skip the rest of the weekly report scaffolding

Output: a short Notion page (or just chat reply) with the same Surfaces table + Reporters subsection, scoped to the asked window.
