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
      **A mismatched HEADLINE does not fail the gate — headlines are marketing, not employment records.** People put a side business, a personal brand, or a "I help X do Y" pitch in the headline while the day job lives in the experience section. Read past the headline (the result snippet usually carries the experience line too) before rejecting a profile. Also try the full name AND the short name — `"Muhammad Mustafa Asif"` and `"Mustafa Asif"` return different results.
      **And if GitHub already names the company, you are CONFIRMING, not discovering.** A populated `company` field plus a corporate commit email means the employer is established; the search only has to find *which profile is his*. Do not let a noisy search downgrade an employer that GitHub and a corporate email already agree on.
   c2. **Try the OTHER name forms before concluding "not found".** GitHub `name`, the commit-author name, the short form, and the form with/without a middle name all retrieve differently. `"<short name>" <company>` is often the query that works.
   d. **Full name — from the authoritative source, NOT GitHub `name`.** GitHub `name` is often just a first name or a handle. Read the self-linked blog/site (or the LinkedIn) for the complete first + last name. *(Precedent: GitHub `name` was "Naveen"; his blog gave "Naveen Chatlapalli" — a first name alone is a flub on a sales list.)*
   e. **Verify the published name matches the profile.** LinkedIn usually returns HTTP 999 to fetchers, so confirm the full name against a *fetchable* self-owned source — their blog, or a LinkedIn article they authored (byline). The name on the report must match the linked profile.
   e2. **VERIFY THE CURRENT ROLE SEPARATELY — a self-linked profile does NOT prove the employer.** A self-link proves only *which profile is theirs*. GitHub bios and corporate commit emails go stale, and search-result titles are cached, so all three can agree and still be out of date. Look for the most RECENT dated evidence: a company people-page, a byline with a date, a press mention. If the live profile can't be read (999), say `current role not verified on the live profile` rather than upgrading stale evidence into a confident claim. When sources disagree, the most recent wins — and show the move (`OldCo → NewCo`) instead of silently picking one.
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

- **A bare GitHub profile is a prompt to go verify externally — not a reason to caveat, and not something to leave unexplained.** The card gives a reader two clickable identities, the GitHub handle and the LinkedIn, and if the profile carries no name or company they won't visibly match. Handle that by **doing the extra verification and then showing the chain**: state which source each fact came from, so a reader who notices the bare profile can see immediately why the identity still holds.
  (Precedent 2026-08-14: `arslan-autoscout24` was published as "Arslan Mehboob" linked to a LinkedIn profile. The evidence was genuinely good — corporate commit email `arslan.mehboob@autoscout24.com`, and AutoScout24's own engineering blog bylines that exact name and links that exact profile. But his **GitHub profile reads `Arslan` with no surname, no company, no bio and no self-linked accounts**, so the surname appears nowhere on GitHub — it comes from an email local-part and an employer blog. A reader comparing the GitHub link to the LinkedIn link reasonably reported them as not matching. **The identity was in fact correct and fully confirmable — the card just never showed its work.** Show the chain and the objection never arises.)

- **An email local-part is a search seed, not a published name.** `arslan.mehboob@…` strongly suggests a surname; it doesn't publish one. **Use it to search** (`"Arslan Mehboob" AutoScout24`) and cite what the search returns — a byline, a self-owned page, a profile result title. Don't publish a surname whose only evidence is an email address, and don't stop at the email either.

- **LinkedIn being unfetchable is NOT a reason to hedge — RUN THE SEARCH.** LinkedIn returns HTTP 999 to automated fetches, so you will never read the profile directly. That is not the end of the road, and treating it as one is the error. A plain `WebSearch` for `"<Full Name>" <Company>` routinely returns the profile as a **result title** carrying both name and employer (`"Arslan Mehboob – AutoScout24 | LinkedIn"`), confirming the match without ever loading the page — and the same search surfaces self-owned bylines (Medium, dev blogs, conference talks, vendor case studies) that independently confirm the name. **Do this before writing any caveat.** Hedge only when the search genuinely fails to line the person up with the employer.

  (Precedent 2026-08-14, and it cost two rounds of review: `arslan-autoscout24` was first published as confirmed on employer-blog evidence. When his bare GitHub profile was pointed out as not matching, the response was to *add* a "verify before outreach" caveat — reasoning that LinkedIn couldn't be fetched, so the current role was unverifiable. **That was wrong twice over: the caveat was unnecessary, and the fix was more hedging instead of five more seconds of work.** One search settled it — the profile's own result title read "Arslan Mehboob – AutoScout24", plus a Medium profile, an AI Mind byline series on agentic-coding platforms, and an AWS case study on AutoScout24's Bedrock "Bot Factory". Four independent sources, and it also revealed the *reason* he's a strong lead: he does agentic-AI platform work for a company already standardizing on it — which the hedged version buried.)

- **🚩 GITHUB IS SELF-DECLARED AND OFTEN STALE. IT IS NOT A SOURCE FOR *CURRENT* EMPLOYER.** People update their GitHub bio years late, or never. A `company` field, a `bio` naming an employer, and even a **corporate commit email** all prove an association *at some point* — none of them proves it is true today. **Establishing the current employer is a separate step, and it is required for every prospect**, because the whole point of the block is that someone will contact this person about their job.
  (Precedent 2026-08-14 — the third identity error in one report: `vasconceloscezar` was published at **Namastex Labs** with the note "best-evidenced identity in this list," on the strength of bio "CTO @namastexlabs" plus corporate commit email `cezar@namastex.ai` plus a **self-linked** LinkedIn. Every one of those was real. But opening the self-linked profile showed his **current** role is founder of a *different, newer* company, with Namastex now prior. The self-link had been treated as proof of the employer when it is only proof of *which profile is his* — and the profile itself was never read.)

- **🚩 SEARCH-RESULT TITLES ARE CACHED AND LAG REALITY — they confirm an association, never a current role.** A result title like `"Cezar Vasconcelos - Namastex Labs | LinkedIn"` is a snapshot of whenever the index last crawled. In the precedent above, the titles **still** read Namastex after he had moved, so the stale answer and the search answer agreed with each other and were both wrong. Use titles to establish *who a person is* and to break name ambiguity; do not use them as evidence of *where they work now* when the stakes are an outreach email.

- **FOLLOW THE THREAD TO THE END, then say which source each claim rests on and when it was checked.** The chain runs: GitHub → self-linked profile → the live profile → recent dated corroboration (a byline, a company people-page, a press mention). **Do not stop at the first link that produces a company name.** When two sources disagree, the **most recent** wins and the block should show the transition (`Namastex Labs → <new company>`) rather than silently picking one — a reader who follows the thread must land where the report says they will.

- **State plainly when the live profile could not be read.** LinkedIn returns HTTP 999, so an agent frequently *cannot* complete the last step. Say so — `current role not verified on the live profile` — instead of upgrading second-hand evidence into a confident claim. **An unread page is a known gap, not a confirmation**, and a human can close it in ten seconds if the block tells them it's open.

- **🚩 A NOISY SEARCH IS NOT EVIDENCE OF ABSENCE — and never let it overturn what GitHub already told you.** When the GitHub `company` field names an employer and a corporate commit email confirms it, the employer is **established**. A search that returns same-name strangers means the search was noisy, not that the person is unverifiable.
  (Precedent 2026-08-14, the fourth identity error in one report: `mustafaasif2` was published as **"LinkedIn not confirmed"** even though GitHub said `company: commercetools` and his commits carry `mustafa.asif@commercetools.com`. The profile was found — `in/mustafa-asif-5b845a198` — and then **rejected because its headline read "CEO @ Ecommerce Revolt Ltd"**. It is the same man: the experience section lists Full Stack Software Engineer at commercetools, Munich. Two failures compounded — testing only the headline, and searching one name form. A human found him with a single obvious query.)

- **Hedging is a last resort, not a safe default.** `verify before outreach` and `LinkedIn not confirmed` have a real cost: they push work back onto sales and make a good lead look shaky. Reach for them only after the cheap checks — `social_accounts`, commit email, a name+company search — have all failed. **An unnecessary caveat is a defect, same as a wrong link.**

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
