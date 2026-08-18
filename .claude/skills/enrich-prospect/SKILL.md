---
name: enrich-prospect
description: Deep enrichment for community-sourced enterprise PROSPECTS (the 🎯 Prospective enterprise customers subsection). For each prospect, resolve their LinkedIn from their GitHub self-linked accounts FIRST (search only if none is self-linked), verify the employer matches, capture their full name, then list the company website + company size (ARR / latest funding round / employee count). Runs as a general-purpose subagent (many web searches) so the orchestrator's context stays small. Invoked by weekly-report (enterprise section) and the enterprise skill.
---

# Deep-enrich enterprise prospects

This is the **deep** enrichment pass — heavier than `enrich-reporter`. `enrich-reporter` just reads the GitHub `company` field to badge everyone 🏢. **This skill runs only on the handful of people who look like real enterprise prospects** (the 🎯 Prospective enterprise customers list) and builds a sales-ready profile per person: verified identity, LinkedIn link, company website, and company size.

## When to invoke

The caller (weekly-report enterprise step, or the `enterprise` skill) has a short list of **prospect handles** already classified as enterprise-worthy (recognizable company, real engagement, real use case — e.g. the Jasper AI / commercetools / Lam Research tier). For each one, spawn a **`general-purpose`** subagent (it needs `gh`, `WebSearch`, and `WebFetch`) with the prompt below. Do NOT run this on every reporter — only the prospect shortlist.

## Subagent prompt template

```
You are deep-enriching enterprise sales prospects for a community report. Accuracy of IDENTITY is the priority — linking the WRONG person is worse than saying "not confirmed". You have gh, WebSearch, WebFetch.

For EACH prospect below (handle + the issue/thread that surfaced them):

1. Seed from GitHub — INCLUDING the self-linked accounts:
   gh api users/<login> --jq '{login, name, company, bio, blog, twitter_username, email, location}'
   gh api users/<login>/social_accounts    # ← the authoritative self-linked LinkedIn / X / etc.
   Capture their name, the company field, employer clues in bio/blog, AND the `social_accounts` URLs.

2. **Resolve the LinkedIn URL + full name — work this ladder IN ORDER, stop at the first step that yields a confirmed profile:**
   a. **Self-linked = authoritative (try FIRST, before any search).** If `social_accounts` has a `linkedin` URL, that IS the profile — use it verbatim, no search, no guessing. Also check the `blog` field (people put their LinkedIn there). A self-linked URL always beats a search hit. *(Miss precedent: the agent name-searched and linked a different person `in/nchatlapalli` when GitHub `social_accounts` already listed `in/navaifanatic`.)*
   b. **Only if nothing is self-linked, search — Google-style web search.** Try, in order: `"<name>" "<company>" LinkedIn`, then `<name> <role from bio> LinkedIn`, then `<github handle> LinkedIn`, then a plain `"<name>" "<company>"`. Also try the company team/about page, the X/Twitter bio, and a GitHub-email search. (`WebSearch` is the tool; it's a general web/Google search.)
   c. **Match gate — applies to any SEARCHED profile (skip for a self-linked URL, which is already theirs).** Accept a searched profile ONLY when its CURRENT employer matches the GitHub `company` (or a clear bio/blog employer). If it doesn't line up, it's a different person — keep searching. Also apply the stale-employer rule ("ex-"/"previously" ≠ current).
   d. **Full name — from the authoritative source, NOT GitHub `name`.** GitHub `name` is often just a first name or a handle. Read the self-linked blog/site (or the LinkedIn) for the complete first + last name. *(Precedent: GitHub `name` was "Naveen"; his blog gave "Naveen Chatlapalli" — a first name alone is a flub on a sales list.)*
   e. **Verify the published name matches the profile.** LinkedIn usually returns HTTP 999 to fetchers, so confirm the full name against a *fetchable* self-owned source — their blog, or a LinkedIn article they authored (byline). The name on the report must match the linked profile.
   f. **If still unconfirmed after all of the above, DO NOT link a guess.** Output `Name: <name> — LinkedIn not confirmed` and list what you tried, so a human can finish it.

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

The identity procedure is the ordered ladder in **step 2 of the subagent prompt above** (self-link first → search → match-gate → full name → verify name↔profile → else not-confirmed). Don't restate it here. This section carries only the one calibration rule the ladder doesn't:

- **Don't over-hedge a lead that checks out.** When the self-linked profile, the GitHub `company` field, and a corroborating web search all point to the SAME current employer, mark the prospect **confirmed** — don't leave it "verify before outreach." Reserve `LinkedIn not confirmed` / `employer unconfirmed` for a genuine gap (no self-linked profile AND search can't line the employer up). Precedent: Parker Roan self-linked his LinkedIn, GitHub `company` said Shipt, and a search returned "Software Engineer at Shipt" — three matching signals = confirmed, not a maybe.

## Company size — what counts

See **step 4 of the subagent prompt above** for the rule. One signal, most-recent only: ARR (only if publicly stated) → latest funding round ONLY (e.g. "Series C, $120M, Oct 2024", not the full history) → employee count / LinkedIn size band → else `size unknown (private, no public figures)`. Never fabricate a number.

## Output block (the required format)

**The whole `### 🎯 Prospective enterprise customers` subsection is a COLLAPSIBLE toggle heading** (`{toggle="true"}`) — collapsed, it shows just the section title; expanded, it reveals every prospect block. All prospect blocks are **tab-indented one level so they nest inside the toggle** (Notion heading-toggles only collapse indented children). **Company is named FIRST** in every block.

Render each prospect as this block (**for a GitHub-sourced prospect**), nested under the toggle heading:

```
### 🎯 Prospective enterprise customers {toggle="true"}
	- **Company:** [<Company>](<company website url>)
		**Name:** [<Full Name>](<LinkedIn url>)   ← or "<Full Name> — LinkedIn not confirmed"
		**Issue:** [<GitHub issue title>](<issue url>)
		**Company Details:** <ARR / latest funding round / employee count, most-recent only>
		**Passed to (sales):** _<blank — Nathan fills>_
	- **Company:** [<next Company>](…)
		…
```

**For a Discord- / Reddit-sourced prospect** (no GitHub issue), swap the `Issue:` line to `**Source:** [<thread / post title>](<thread url>)`.

Rules for the block:
- **Company first** — the reader scans the section by company name.
- **Collapsible section** — the section heading carries `{toggle="true"}` and every block is indented to nest inside it, so the whole prospect list collapses to one line.
- **Author with REAL newlines and REAL tab characters** — NOT the literal escape sequences `\n` / `\t`. `notion-update-page` `replace_content` / `insert_content` pass `\n` / `\t` through as literal `n` / `t` and mangle the block (they run onto one line). Use actual line breaks + tabs. (`update_content` does interpret `\n`, but for the nested-tab structure prefer real tabs to be safe.)
- **Every line carries a real link** (company site, LinkedIn, issue) per the mandatory-source-link rule. The `Issue:`/`Source:` link is what surfaced them and is non-negotiable — no link, the prospect isn't published.
- **`Passed to (sales):` is always a blank owner field** — never auto-name a person; Nathan tags whoever he handed the lead to (same manual-owner rule as the issue cards).
- One block per prospect. If two handles are the same person, merge into one block.

## How the orchestrator consumes this

- Replaces the old single-line prospect bullet in the **🎯 Prospective enterprise customers** subsection with these structured blocks.
- The step-14 link-review pass (Subagent F) still applies: any block whose `Issue:`/`Source:`/`Name:`/`Company:` link can't be sourced gets flagged; an unconfirmable LinkedIn stays as `LinkedIn not confirmed` (not removed — the prospect is still real via the issue link), but a missing **source** link removes the prospect.

## Cross-references

- `enrich-reporter` — the shallow pass (company field → 🏢 badge) run on ALL reporters; this skill is the deep pass on the prospect shortlist only.
- `weekly-report` — invokes this in the Enterprise step for the 🎯 Prospective enterprise customers subsection.
- `enterprise` — standalone enterprise view; uses this skill for its prospect list too.
