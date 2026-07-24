---
name: enrich-reporter
description: Subagent for GitHub author enterprise enrichment. Runs gh api users/<login> for each unique handle and classifies enterprise vs indie. Invoked by weekly-report or enterprise skills; runs as Explore subagent so the orchestrator's context stays small.
---

# Enrich reporters with company affiliation

## When to invoke

Caller has a list of GitHub usernames (this week's authors + carryover-open roster across both repos). Need company affiliation for the Enterprise section and inline 🏢 badges.

Spawn an `Explore` subagent (or any read-only general-purpose) with this prompt:

## Subagent prompt template

```
For each GitHub username below, run:
  gh api users/<login> --jq '{login, name, company, bio, blog, twitter_username}'

Return a compact one-line-per-user table:
  login | name | company | profile_url | company_url | bio | blog | twitter

  - profile_url = `https://github.com/<login>` (always — used to link the handle on every card).
  - company_url = the company's website for enterprise reporters (e.g. Amazon → https://www.amazon.com, Nvidia → https://www.nvidia.com); blank for indie. Used to link the 🏢 Company badge. Don't guess a URL — leave blank if unsure.

Then two bulleted lists:
- Enterprise reporters (company field populated, OR bio/blog clearly identifies an employer — mark inferred ones as "(inferred)")
- Indie / no affiliation

Logins:
<list>

Run them in parallel via xargs or a small loop. Under 350 words total.
```

## Classification rules

- **Direct enterprise (confirmed):** `company` field populated AND corroborated by the bio/blog/a verifiable identity → use that as canonical affiliation, mark `confirmed`.
- **Self-declared only (UNCONFIRMED):** the `company` field names an employer but nothing else corroborates it — no bio mention, no verifiable name/LinkedIn, throwaway-looking account. Still surface it, but mark it **`unconfirmed (self-declared)`** so the report can flag "⚠️ Company unconfirmed" in 🏢 Enterprise. Never present it as fact. (Precedent: `GeauxEric` → `company: Nvidia`, no verifiable identity → unconfirmed.)
- **Inferred enterprise:** `company` empty, but bio or blog clearly identifies an employer (e.g. "Engineer @AcmeCorp", LinkedIn profile naming a current role) → label as `<Company> (inferred)`. Still treat as enterprise signal.
- **Indie / no affiliation:** no company, no employer clues. Default classification.
- **404 / nonexistent user:** note explicitly. Sometimes handles get renamed; check if the issue still resolves.

## Identity collisions

- **Two GitHub handles, same person:** matching `name` field or obvious rename → merge into one reporter; reduce distinct-reporter count accordingly. Note inline: ``handle-a` / `handle-b` — *same person, <Name>, filed under two handles*``.
- **Same author, multiple issues that are functionally one signal** (e.g. one person opens two HVTracker-promo issues with different titles) → count as **one reporter, one signal**. Note in community-ops or Resolved: ``<login>` filed [#A](...) and [#B](...) — same person, same promo pattern, one signal``.

## Discord users

Don't enrich Discord-only handles via `gh api` — their profiles don't expose company. List them without a 🏢 badge by design. **The absence is the signal.**

If a Discord handle is also a known GitHub handle (rare but happens — e.g. someone uses the same username on both), enrich via the GitHub side and link the Discord handle inline alongside their issue.

## Output shape

```
| login | name | company | bio |
|---|---|---|---|
| umax-imagination-media | Max Uroda | @Imagination-Media | Senior Software Engineer, GCP Digital Leader |
| deepakbatham572 | — | — | — |
...

**Enterprise reporters:**
- umax-imagination-media (Imagination Media)
- Siddhartha90 (Apple — inferred from bio)

**Indie / no affiliation:**
- deepakbatham572
- ...
```

## How the orchestrator consumes this

- **Inline 🏢 badge** next to each enterprise user's handle in reporter rosters, Resolved section, Community ops.
- **🏢 Enterprise section — Reporters this week** subsection: one bullet per company, count + linked handles + GitHub issue refs + prior-week trend.
- **Headline call-out** if enterprise reporters cluster on top pain / top demand (decision-relevant signal for sales/CS).
- **No badge ≠ unimportant** — indie reporters often carry top pain. Just no enterprise pull on that signal yet.
