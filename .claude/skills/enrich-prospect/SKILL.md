---
name: enrich-prospect
description: Deep enrichment for community-sourced enterprise PROSPECTS (the 🎯 Prospective enterprise customers subsection). For each prospect, find their LinkedIn profile, verify the LinkedIn employer matches the company on their GitHub (keep searching if it doesn't), then list the company website + company size (ARR / latest funding round / employee count). Runs as a general-purpose subagent (many web searches) so the orchestrator's context stays small. Invoked by weekly-report (enterprise section) and the enterprise skill.
---

# Deep-enrich enterprise prospects

This is the **deep** enrichment pass — heavier than `enrich-reporter`. `enrich-reporter` just reads the GitHub `company` field to badge everyone 🏢. **This skill runs only on the handful of people who look like real enterprise prospects** (the 🎯 Prospective enterprise customers list) and builds a sales-ready profile per person: verified identity, LinkedIn link, company website, and company size.

## When to invoke

The caller (weekly-report enterprise step, or the `enterprise` skill) has a short list of **prospect handles** already classified as enterprise-worthy (recognizable company, real engagement, real use case — e.g. the Jasper AI / commercetools / Lam Research tier). For each one, spawn a **`general-purpose`** subagent (it needs `gh`, `WebSearch`, and `WebFetch`) with the prompt below. Do NOT run this on every reporter — only the prospect shortlist.

## Subagent prompt template

```
You are deep-enriching enterprise sales prospects for a community report. Accuracy of IDENTITY is the priority — linking the WRONG person is worse than saying "not confirmed". You have gh, WebSearch, WebFetch.

For EACH prospect below (handle + the issue/thread that surfaced them):

1. Seed from GitHub:
   gh api users/<login> --jq '{login, name, company, bio, blog, twitter_username, email, location}'
   Capture their name, the company field, and any employer clue in bio/blog.

2. Find their LinkedIn profile:
   - WebSearch: "<name> <company> LinkedIn", then "<name> <role from bio> LinkedIn", then "<github handle> LinkedIn".
   - The candidate profile's CURRENT employer MUST match the GitHub company (or a bio/blog employer clue). This is the match gate.
   - IF IT DOESN'T MATCH, KEEP SEARCHING — try the blog/personal site, the company team/about page, the Twitter/X bio, a plain Google-style query ("<name>" "<company>"), a GitHub-email search. Only accept a LinkedIn URL when the employer lines up.
   - If after real effort you cannot confirm the same person, DO NOT link a guess. Output `Name: <name> — LinkedIn not confirmed` and say what you tried.

3. Company website: find the official company site (not a directory page). Prefer the root domain.

4. Company size — ONE of these, most-recent only, whichever is findable (search Crunchbase / PitchBook mentions / the company's own site / press / LinkedIn company page):
   - ARR (if publicly stated), OR
   - latest funding round ONLY (e.g. "Series B, $50M, 2024" — not the full history), OR
   - employee count (e.g. "~500 employees" or a LinkedIn band like "201–500").
   - If nothing public: `size unknown (private, no public figures)`. Never fabricate a number.

5. Note the confidence + the sources you used (URLs).

Prospects (handle · surfacing issue/thread URL · GitHub company seed):
<list>

Return, per prospect, the exact block format in "Output block" below. Cite a real URL for every link. Under 250 words per prospect.
```

## Match gate (identity accuracy)

- **The LinkedIn person's current employer must match the GitHub `company` (or a clear bio/blog employer).** If GitHub says `@commercetools` and the first LinkedIn hit works somewhere else, that's a different person — keep searching.
- **Never link a "maybe".** A wrong LinkedIn link in a sales handoff is a real cost. When unconfirmed, write `LinkedIn not confirmed` and list what was tried, so a human can finish it.
- **Stale-employer rule (same as enrich-reporter):** if the bio says "ex-", "previously", "formerly", that employer does NOT count as current — it disqualifies both the prospect classification and the match.

## Company size — what counts

Report the single best available signal, most-recent only:

- **ARR** — only if publicly stated (rare for private co's).
- **Funding — latest round ONLY.** "Series C, $120M, Oct 2024." Do not list the full round history; the current stage is what sales needs.
- **Employees** — a real count or a LinkedIn size band.
- **Unknown** — `size unknown (private, no public figures)`. Honest beats invented.

## Output block (the required format)

Render each prospect as this block. **For a GitHub-sourced prospect:**

```
- **Issue:** [<GitHub issue title>](<issue url>)
  **Name:** [<Full Name>](<LinkedIn url>)   ← or "<Full Name> — LinkedIn not confirmed"
  **Company:** [<Company>](<company website url>)
  **Company Details:** <ARR / latest funding round / employee count, most-recent only>
  **Passed to (sales):** _<blank — Nathan fills>_
```

**For a Discord- / Reddit-sourced prospect** (no GitHub issue), swap the first line to the source thread:

```
- **Source:** [<thread / post title>](<thread url>)
  **Name:** [<Full Name>](<LinkedIn url>)
  **Company:** [<Company>](<company website url>)
  **Company Details:** <size>
  **Passed to (sales):** _<blank — Nathan fills>_
```

Rules for the block:
- **Every line carries a real link** (issue, LinkedIn, company site) per the mandatory-source-link rule. The `Issue:`/`Source:` link is what surfaced them and is non-negotiable — no link, the prospect isn't published.
- **`Passed to (sales):` is always a blank owner field** — never auto-name a person; Nathan tags whoever he handed the lead to (same manual-owner rule as the issue cards).
- One block per prospect. If two handles are the same person, merge into one block.

## How the orchestrator consumes this

- Replaces the old single-line prospect bullet in the **🎯 Prospective enterprise customers** subsection with these structured blocks.
- The step-14 link-review pass (Subagent F) still applies: any block whose `Issue:`/`Source:`/`Name:`/`Company:` link can't be sourced gets flagged; an unconfirmable LinkedIn stays as `LinkedIn not confirmed` (not removed — the prospect is still real via the issue link), but a missing **source** link removes the prospect.

## Cross-references

- `enrich-reporter` — the shallow pass (company field → 🏢 badge) run on ALL reporters; this skill is the deep pass on the prospect shortlist only.
- `weekly-report` — invokes this in the Enterprise step for the 🎯 Prospective enterprise customers subsection.
- `enterprise` — standalone enterprise view; uses this skill for its prospect list too.
