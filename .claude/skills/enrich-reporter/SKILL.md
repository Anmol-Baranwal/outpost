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
For each GitHub username below, run ALL THREE:
  gh api users/<login> --jq '{login, name, company, bio, blog, twitter_username}'
  gh api users/<login>/social_accounts    # ← the person's OWN self-linked LinkedIn / X / site — authoritative
  # If the profile has a real FULL NAME but no company, ALSO run one web search
  # before calling anyone indie:  "<Full Name>" <role/tech from bio> linkedin
  # A profile result title ("Alberto Ciolini - Verizon Connect | LinkedIn") settles
  # the employer without opening LinkedIn. Skip only for handle-only accounts.
  gh api "search/commits?q=author:<login>" --jq '[.items[].commit.author | {name, email}] | unique'
      # ← COMMIT-AUTHOR EMAIL is the strongest employer proof available. A corporate
      #   email domain confirms current employment better than any self-declared field,
      #   and it also yields the person's real full name for the sales list.
      #   Rate limit ~30/min — pace it and back off on 403.
  gh api users/<login>/orgs --jq '[.[].login]'   # ← public org membership; how you catch OUR OWN STAFF

Return a compact one-line-per-user table:
  login | name | company | profile_url | company_url | linkedin_url | bio | blog | twitter

  - linkedin_url = the `linkedin` URL from `social_accounts` if present (the self-linked, authoritative profile — never a search guess); else blank. The prospect pass reuses this instead of searching.

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

- **EXCLUDE OUR OWN STAFF — check this first, before any classification.** Anyone who is a public member of the `CopilotKit` or `ag-ui-protocol` orgs, or commits under an `@copilotkit.ai` email, is **staff, not a community reporter**. Their issues still appear in the report as real work, but they are excluded from community reporter counts, never badged 🏢, and never routed to the prospect list. **Say the corrected counts out loud** so downstream sections don't inherit the inflated ones. (Precedent 2026-08-14: `mxmzb`, `BenTaylorDev` and `contextablemark` were all in the "community authors" input list — excluding them moved CopilotKit's in-window author count from 3 to **2** and AG-UI's from 12 to **10**, and reclassified five items from community signal to internal engineering findings.)
- **Direct enterprise (confirmed):** `company` field populated AND corroborated by the bio/blog/a verifiable identity → use that as canonical affiliation, mark `confirmed`.
- **Corp-email confirmed (STRONGEST — prefer this over every other signal):** a commit-author email on a corporate domain (`arslan.mehboob@autoscout24.com`, `mustafa.asif@commercetools.com`) confirms the employer even when the profile is completely bare — no company field, no bio, no name. This is the only method that works on empty profiles, and on 2026-08-14 it confirmed four employers nothing else could reach. **Its silence is also evidence:** when `search/commits` returns only personal-domain emails, that supports "unaffiliated on paper" rather than meaning you didn't look hard enough — report it that way.
- **Self-declared only (UNCONFIRMED):** the `company` field names an employer but nothing else corroborates it — no bio mention, no verifiable name/LinkedIn, throwaway-looking account. Still surface it, but mark it **`unconfirmed (self-declared)`** so the report can flag "⚠️ Company unconfirmed" in 🏢 Enterprise. Never present it as fact. (Precedent: `GeauxEric` → `company: Nvidia`, no verifiable identity → unconfirmed.)
- **Inferred enterprise:** `company` empty, but bio or blog clearly identifies an employer (e.g. "Engineer @AcmeCorp", LinkedIn profile naming a current role) → label as `<Company> (inferred)`. Still treat as enterprise signal.
- **Indie / no affiliation:** no company, no employer clues **AND a name search came back empty.** Never the default — see the next rule.
- **🚩 NEVER classify someone indie off a sparse profile without searching their name.** An empty `company` field means the profile is empty, not that the person is unaffiliated. If you have a **real full name** in the `name` field, run one `WebSearch` for `"<Full Name>" <role or tech from bio> linkedin` before writing "indie." A profile-result title alone (`"Alberto Ciolini - Verizon Connect | LinkedIn"`) settles the employer without opening LinkedIn. This costs one search per named reporter and it is the difference between an enterprise signal and a missed one.
  (Precedent 2026-08-14, and it was missed twice in one report: `ciolo` was classified **"Academic (MSc Univ. of Florence), gmail commits. Indie."** on the strength of `company: null` + a university bio. He is **Alberto Ciolini at Verizon Connect** — Verizon's fleet-telematics subsidiary — and he had filed *two* Strands feature requests three weeks apart. One search on his name returned the profile as the third hit. He was consequently missing from "Companies building on us" and from the prospect list, and the prospect entry that *did* exist credited the AutoScout24 engineer who merely implemented his request. **A bio that names a university is a bio, not an employer.**)
- **Distinguish the requester from the implementer.** Enterprise signal attaches to the person who **asked** — they have the business need. The contributor who implements someone else's request is a separate signal (often also enterprise, occasionally the same person). When an issue and its fix PR have different authors, enrich and count **both**, and never let the PR author's employer stand in as the issue's origin.
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
