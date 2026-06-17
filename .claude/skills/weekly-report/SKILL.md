---
name: weekly-report
description: Fri→Fri community signals routine across CopilotKit + AG-UI. Orchestrator that supervises subagents — Discord pull, GitHub pull, deep-read, reporter enrichment — and synthesizes a Notion report under the Community Signals parent page. Triggers on "go", "weekly report", "community signals", "run routine".
---

# Weekly community signals — orchestrator

You are the orchestrator. Your job is to **delegate the heavy work to subagents** so your context stays small, then synthesize their compact returns into the Notion report. Do not pull all Discord / GitHub data into your own context.

## Output

A new Notion page under **Community Signals** parent (`3673aa38-1852-80bc-a71f-d328d765668d`) titled:

```
Weekly Community Signal — <Mon DD>-<DD>, <YYYY>
```

The main page **leads with the cross-community `## 🔝 Top issues of the week`** (ranked) — the front-page news — then carries the CopilotKit community sections plus the cross-community 🏢 Enterprise and 🔄 Patterns sections. **AG-UI always lives on its own sub-page**, created as a child of the main page and linked at the top (via a `<page url="…">` block). The AG-UI sub-page holds AG-UI's per-community detail; the headline ranking and the takeaways are unified on the main page.

Covering the **most recent complete Friday→Friday week** (Friday end-date inclusive). State the window before pulling data.

## Orchestrator flow

1. **Determine the window.** Today's date → most recent complete Fri→Fri. State it.

2. **Spawn Subagent A — Discord pull.** Tell it to pull both servers:
   - CopilotKit (`1122926057641742418`): `#💬｜general` (text `1182553320540352563`) + `#🤔｜support` (forum `1313616713647919218`)
   - AG-UI (`1379082175625953370`): `#🔧-building` (text `1379082271642095738`) + `#✈️-support` (forum `1384529894972592158`)
   For forums use `mcp__discord__list_forum_threads` → filter to window → `mcp__discord__read_thread_messages` per in-window thread. **Read every thread to the bottom.** Return: compact per-channel substantive-message summary, with reporter handles + 1-line summaries. Skip hiring / self-promo / greetings (those roll up under Community Ops).

3. **Spawn Subagent B — GitHub pull.** Both repos, same window:
   ```
   gh issue list --repo CopilotKit/CopilotKit --state all --limit 60 --search "created:<start>..<end>" --json number,title,body,url,author,createdAt,state
   gh issue list --repo ag-ui-protocol/ag-ui --state all --limit 60 --search "created:<start>..<end>" --json number,title,body,url,author,createdAt,state
   ```
   Return: issue list tagged by community, with author + state + 1-line summary.

   **Catch escalations on old issues — the `created:` window misses them.** Also run an `updated:`-window search over OPEN issues (front-door categories especially: quickstart/CLI/install, upgrade path, docs landing, prod builds, auth/security) and **always read the comments** on anything that surfaces — escalations, maintainer commitments, and "fix in progress" status live in comments, not issue bodies:
   ```
   gh issue list --repo <repo> --state open --limit 60 --search "updated:<start>..<end>" --json number,title,url,author,createdAt
   ```
   An old front-door issue with in-window comment activity belongs in this week's report — in BOTH community reports if the broken artifact spans them (precedent: [ag-ui#1518](https://github.com/ag-ui-protocol/ag-ui/issues/1518), quickstart CLI broken since April, escalated via comment two months later; the failing `npx copilotkit` package made it a CopilotKit front door too).

4. **Spawn Subagent C — Deep-read** (see `deep-read-issue` skill). For each in-window actionable issue + every detected fix PR. Returns: file paths, reviewer concerns, hidden bugs, test coverage, fix-PR scope.

5. **Spawn Subagent D — Enrich reporters** (see `enrich-reporter` skill). For every GitHub author across both repos + the prior-week roster. Returns: company affiliation table + enterprise list.

6. **Cluster into Demand + Pain.** Per community. Apply threshold rule:
   - 2+ distinct people this week, OR
   - 1+ this week AND verifiable prior reference (issue #, thread ID, prior-report URL).
   Singletons → Early signals.
   **Override:** front-door categories skip threshold (see `front-door-triage` skill). Front-door / P0 items don't just headline their community — they feed the cross-community **🔝 Top issues of the week** ranking (see below), led by the biggest front-door break.

7. **Compute trend vs prior 7 days.** ↑ grew · ↓ shrank · → flat · ↑ new cluster.

8. **Detect resolutions.** Classify each in-window CLOSED issue: `FIX_PR_MERGED` / `BACKFILLED` / `FALSE_POSITIVE` / `DUPLICATE` / `WONT_FIX` / `CLOSED_NO_ACTION`.

9. **Fix-PR detection** for every issue mentioned (this week + carryover):
   ```
   gh pr list --repo <repo> --state all --search "fixes #<num> OR closes #<num>" --json number,title,state,url,isDraft,mergedAt
   ```
   Markers: `🛠️ Fix PR [#NNNN](url) OPEN` · `🛠️ Fix PR [#NNNN](url) MERGED <date>` · `🛠️ No fix PR yet.`
   Procedurally-closed PRs (branch-name violation etc.) don't count as competing fixes — read closing comment.

10. **Score & rank the Top issues** (see the ranking rubric in `front-door-triage`). First **record the naive order** — what you'd get ranking the candidates by loudness alone (engagement: 👍 + comments, recency, reporter count) — so the comparison page can show the delta. Then **score each candidate on the five axes** (surface tier · blast radius · severity · exposure · signal), using measurable inputs — `gh issue view --json reactionGroups,comments,labels`, fix-PR status from step 9, Discord distinct-reporter counts, and the enrichment. Sum, sort descending; the top 3–5 are the Top issues, ranked. Keep BOTH the scored table and the naive order — they get published in the ranking + comparison child pages (step 11). Community (CK vs AG-UI) is never an axis.

11. **Build the Notion pages** via `mcp__plugin_Notion_notion__notion-create-pages`. Create the AG-UI sub-page FIRST (as a child of the main page), then the main CopilotKit page references it at top with a `<page url="…">` block. **Last, create two child pages** at the bottom of the main report (both children of the main page): **`📊 Top-issue ranking`** (the rubric + this week's scored table) and **`🔬 Ranking comparison — before vs after the algo`** (the naive-by-loudness order vs the scored order, with the delta + a "why it moved" note). Link both from a bottom line on the main page and the AG-UI sub-page. See "Page structure" + "Top-issue ranking child page" below.

   **Notion tooling gotchas (learned the hard way):**
   - `notion-create-pages` interprets `\n` / `\t` escapes correctly — author content with them.
   - `notion-update-page` `replace_content` / `insert_content` do **NOT** interpret `\n` / `\t` — they pass through as literal `n` / `t` and mangle the page. Use **real newline and tab characters** in `new_str`.
   - `notion-update-page` `update_content` (search/replace via `content_updates`) **does** interpret `\n` — handy for surgical inline edits and small block inserts without rewriting the whole page.
   - `replace_content` deletes any child page not referenced in `new_str`. To preserve the AG-UI sub-page, include its `<page url="…">` block in the new content (don't rely on `allow_deleting_content`).

12. **Draft Slack TL;DR** via `slack-tldr` skill. Save to `/tmp/slack-msg.json`. Show Nathan to review before he curls.

13. **Verify every link before publishing.** Wrong links destroy trust in the report. Checks:
   - Every Discord thread URL: confirm the thread ID came from this run's `list_forum_threads`/pull output (never from memory or a prior report) and that the anchor text matches the thread's actual title/topic.
   - Every issue/PR number: the linked number must match the title quoted next to it.
   - External links (YouTube/Loom repro videos, docs): only use URLs that appear verbatim in the source thread/issue — never reconstruct from memory. Link repro videos explicitly; don't write "video on YouTube" without the URL.
   - Anchor text must name what the reader will land on ("Dojo jumpy scroll" → the jumpy-scroll thread, not an adjacent thread).

14. **Remind Nathan to record a Loom walkthrough — every report, no exceptions.** When he shares the link: add a `**Loom:** [Walkthrough](url)` line to the main page header (directly under the `**Week:**` line) and a `🎥 Walkthrough → <url|Loom>` line to the Slack message above the "Full report" link. Don't let the Slack message go out without asking about the Loom first.

## Page structure

**MAIN PAGE — CopilotKit + cross-community Enterprise**

```
[H1 title]
**Week:** Fri YYYY-MM-DD → Fri YYYY-MM-DD     ← only line in the header block

## 🔝 Top issues of the week                    ← THE LEAD — cross-community, ranked by importance. See "Top issues of the week" below. Each item a toggle: what · impact · fix plan, tagged [CK]/[AG-UI]. Lead with the biggest front-door break.
---

## 📦 CopilotKit                                ← community header
*↓ Companion report — the AG-UI half of this week is on its own page:*   ← italic label so the link reads as nav, not a heading
<page url="…">AG-UI sub-page title</page>      ← AG-UI sub-page link (give the sub-page a DISTINCT icon, e.g. 🔷, so it doesn't mirror the 📦 header)
---                                             ← divider before the TL;DR

## TL;DR                                        ← CopilotKit metrics, hyperlinked bullets, 📚 Docs watch line. (No front-door line — front-door breaks are the cross-community Top issues above.)
   ### 🔥 Demand
   ### 💢 Pain
   ### 📚 Docs                                  ← standing weekly section: drift / gaps / links-&-bot (see "Docs section" below)
   ### ✅ Resolved this week                    ← XML table
   ### 📊 Pulse                                 ← Volume + open fix PRs
   ### Community ops

## 🏢 Enterprise                                ← cross-community, BELOW the CopilotKit sections (see "Enterprise section" below)
   ### Surfaces this week                       ← table: Enterprise Intelligence, CopilotKit Cloud, License onboarding, Security disclosure channel, Self-host runtime. Skip SSO/OAuth + Billing rows when no reports.
   ### Companies building on us this week       ← CURRENT-employer only (ex-employers / notable individuals don't count); per-company bullets
   ### Enterprise-offering reactions            ← reaction to Slack / Teams / threads-persistence; state the silence explicitly when there's none

## 🔄 Patterns — the takeaways                  ← ELEVATED + always-open, cross-community. The compressed read — what to act on. (Patterns are the most important part — leadership reads this first.)
## Gaps & follow-ups                            ← cross-community checklist
## Methodology                                  ← <details><summary> wrapped; threshold, window, sources
<page url="…">📊 Top-issue ranking</page>      ← child page at the very bottom: the public rubric + this week's scored table
<page url="…">🔬 Ranking comparison</page>     ← child page: naive-by-loudness order vs the scored order, with the delta + why each moved (see "Top-issue ranking child page" below)
```

**AG-UI SUB-PAGE — same shape, AG-UI only**

```
[H1 title]
**Week:** Fri YYYY-MM-DD → Fri YYYY-MM-DD

## 📦 AG-UI                                     ← community header at the very top of every AG-UI page
   <callout>                                    ← note: this week's ranked Top issues are unified on the main page; list which of them are AG-UI's + link back

## TL;DR                                        ← (no front-door subsection — Top issues are unified cross-community on the main page)
   ### 🔥 Demand
   ### 💢 Pain
   ### 📚 Docs
   ### ✅ Resolved this week
   ### 📊 Pulse
   ### Community ops

## 🔄 Patterns — AG-UI                          ← AG-UI-scoped; points to the main "Patterns — the takeaways" for the cross-community read
## Gaps & follow-ups — AG-UI                     ← AG-UI-scoped checklist
## Methodology
<mention-page>📊 Top-issue ranking</mention-page>  ← bottom link to the main report's ranking child page (don't duplicate it here)
```

If a per-community subsection is empty, render "No X this week." Don't omit the heading.

**Page split is mandatory, not conditional.** AG-UI always gets its own sub-page (even when thin); the main page is always the CopilotKit report. 🏢 Enterprise stays cross-community on the main page. 🔝 Top issues and 🔄 Patterns — the takeaways are cross-community on the main page. Gaps / Methodology are split per page; AG-UI keeps a short AG-UI-scoped Patterns that points back to the main takeaways.

**The main page LEADS with `## 🔝 Top issues of the week`** — above the `## 📦 CopilotKit` community header. It's the front-page news, cross-community, ranked. The AG-UI sub-page opens with its `## 📦 AG-UI` header (no Top-issues section of its own — they're unified on the main page).

**TL;DR sits under the community header.** Below the `## 📦 CopilotKit` header (and the AG-UI sub-page link). It carries metrics + the 📚 Docs watch line — **no front-door line** (front-door breaks are the Top issues at the very top). 🏢 Enterprise sits below the CopilotKit sections.

**Sub-page naming.** Title the AG-UI sub-page `Weekly Community Signal — AG-UI — <Mon DD>-<DD>, <YYYY>` (e.g. `Weekly Community Signal — AG-UI — May 26-Jun 08, 2026`). Main page keeps `Weekly Community Signal — <Mon DD>-<DD>, <YYYY>`.

## Page rendering rules

- **Always-open sections:** Header, 🔝 Top issues of the week, AG-UI sub-page link, 🏢 Enterprise (all subsections), per-community TL;DR, ✅ Resolved this week, 🔄 Patterns — the takeaways, Gaps & follow-ups. **Patterns is always open — never a `<details>`.** It's the most-read section.
- **Toggle headings (`### Title {toggle="true"}`):** every Top-issue card + every Demand/Pain cluster card. Body bullets **tab-indented** to be inside the toggle.
- **No 🚨 sirens on the Top-issue cards.** Rank them `### 1.` / `### 2.` … — the numbering carries the priority; sirens per card look noisy.
- **`<details><summary>` blocks:** Early signals, Pulse body, Community ops, Methodology. (Patterns is NOT one of these anymore.)
- **Notion XML `<table header-row="true">…</table>`** form (not Markdown pipes) inside toggles/details.
- **Visual polish:** AG-UI sub-page gets a distinct icon (🔷) so its link doesn't read as a duplicate of the 📦 header; an italic "↓ Companion report" label sits above the link; `---` dividers between the top-level `##` sections (TL;DR / Enterprise / Patterns / Methodology) to break up the column. (No table-of-contents — it ate too much vertical space.)

## TL;DR titles must be hyperlinks

Within each per-community `### TL;DR`:
- **Top pain — X** → link to the bug report (GitHub issue or canonical Discord thread). **Not the fix PR.**
- **Top demand — X** → link to the canonical request URL.
- **Pulse this week** → link to repo's open-PRs queue.
- **🏢 Companies building on us this week** → link to a `gh issues` filter URL listing the in-week enterprise authors (current employer only), or omit if zero.

## Top issues of the week (the lead section)

The report **leads** with `## 🔝 Top issues of the week` — cross-community, at the very top of the main page, above the CopilotKit header. This replaces the old per-community "front-door flags" treatment: front-door breaks ARE the top issues, now ranked together across both repos.

What goes in it (per leadership):
- **Not exhaustive — only what leadership should actually know.** "If you're our eyes and ears, what should we know?" 3–5 items, max. A quiet week can have fewer.
- **Ranked by importance.** Number them `### 1.` `### 2.` … Lead with the biggest front-door break — the surface the most users hit. A broken install/quickstart CLI (e.g. `npx create-ag-ui-app`) is a bigger front door than any single feature bug; an outage on the current release is front-page.
- **Each card is self-contained** — enough to know what happened without digging. Three lines:
  - **What:** the concrete failure (e.g. "`npx copilotkit` fails at install with `ETARGET proxy-from-env`").
  - **Impact:** who hit it and how bad ("every new user following the quickstart; dead at step 1; broken ~2 months").
  - **Fix plan:** shipped / in-progress / not-started + the PR or release. Call out **"fixed same day"** when true.
- **Tag each `[CK]` / `[AG-UI]` / `[CK + AG-UI]`** and link the canonical issue.
- **Front-page items get the CI-gap takeaway.** If something big shipped broken, ask in the card "how did this ship?" — usually a missing smoke test. That's the actionable signal, not just the symptom.
- The front-door P0 categories (`front-door-triage` skill) define what's *eligible*; the ranking decides what's *shown*.

The TL;DR no longer carries a separate front-door line — the Top issues section is the front-door view.

## Top-issue ranking child page (public algo)

Every report ends with a child page — `📊 Top-issue ranking` — created as a child of the main page (last, after the AG-UI sub-page) and linked from the bottom of both pages. It makes the ranking **auditable**: anyone can see why #1 beat #2 rather than trusting a judgment call.

Contents:
- **The rubric** — the five-axis scoring table (surface tier · blast radius · severity · exposure · signal) copied from `front-door-triage`, plus the "community is never an axis" + "fix status is a tag, not a demotion" rules.
- **This week's scored table** — one row per ranked candidate: `# · candidate (linked) · [CK]/[AG-UI] · surface · blast · severity · exposure · signal · TOTAL`, sorted by total. Note the measurable input behind any non-obvious score (e.g. "blast 5: default onboarding path; 👍 12 on the issue").
- **Tie-breaks** — note any (Blast radius, then Surface tier) so the order is fully reproducible.

The point: the rank is shown as arithmetic, not asserted. If someone disagrees, they argue with a number on an axis — not with "why is this #1?".

**Companion `🔬 Ranking comparison` child page.** A second child page shows the algo earning its keep: the **naive order** (rank by loudness — engagement + recency + reporter count, captured in step 10) vs the **scored order**, as a `candidate | naive rank | algo rank | Δ` table, then a short "what changed, and why" — call out anything the rubric moved and the reason (e.g. "a quiet 2-month onboarding break beat a loud same-day-fixed outage because importance ≠ loudness"). When the order is unchanged, say so — that's the algo *validating* the read, which is also worth showing.

## Docs section (standing, weekly)

Every report carries a `### 📚 Docs` section per community, between 💢 Pain and ✅ Resolved. It is the weekly docs-debt window — three labeled item types, plain bullets (no toggles):

- **Drift** — code moved, docs didn't (wrong wrapper in a quickstart, page documenting a broken flow).
- **Gap** — a needed guide that doesn't exist (persistence per adapter, self-host AgentRunner, history retrieval).
- **Links/bot** — dead doc URLs, support-bot citing 404s or stale answers.

Rules:
- A docs item that **blocks** a new/upgrading user is ALSO a Top issue — list it in both, labeled "(blocking — also a Top issue)" in the Docs section. Non-blocking docs items live only here.
- Add a `📚 **Docs watch** — N items (M blocking): <short list>` line at the top of the CopilotKit TL;DR bullets. A blocking docs item is also a Top issue — list it in both.
- Always render the section; if empty, "No docs items this week."

## Enterprise section (current-employer rule)

🏢 Enterprise stays cross-community on the main page, BELOW the CopilotKit sections. Two subsections:

**Companies building on us this week** — the signal is **a company currently using/building on us**, surfaced through someone who *currently* works there.
- **Verify the current employer** with `gh api users/<login>` AND read the bio — the `company` field is often stale. If the bio says "ex-", "previously", "prior experience: …", they do NOT count, even if `company` still lists it. (Precedent: a reporter showed `company: Apple` but bio said "Prior experience: Apple" — ex-Apple, dropped.)
- **Ex-employers and "notable individuals" don't count** — track them as community reporters, not enterprise. Only "Company X currently builds on us" earns the 🏢 badge.
- Per-company bullet: who, where they currently work, what they filed, and the strength of signal (e.g. "submitted a fix PR — building on our a2a path").
- When correcting a prior week's overcount, say so in a short `<details>` so the trend stays honest.

**Enterprise-offering reactions** — explicitly report community reaction to the enterprise surfaces, especially **Slack / Teams integrations** and **threads / persistence**. **If there was no reaction, say so** ("No questions about Slack/Teams this week") — silence is itself a signal worth flagging. Surface recurring complaints (e.g. the threads-pricing gripes) as patterns, not buried detail.

## Patterns — the takeaways (elevated)

`## 🔄 Patterns — the takeaways` is **always open** (never a toggle/`<details>`) and sits cross-community on the main page. It is the most important section — the compressed read of what to *act on*, not per-issue detail.

- Each bullet = one pattern, stated as a takeaway a busy exec can act on. "v2 chat UI is accumulating polish debt." "Our front doors break without CI catching them." Not "issue #X and #Y and #Z."
- Think: telling someone what's in front of them — "truck coming," not "there's a green flower and also a trash can." Surface the thing that changes a decision.
- Every named entity hyperlinked (issues, handles, surfaces).
- 3–5 patterns. This is where the week's detail gets distilled into signal.

## Reporter formatting

- Every Discord mention is a hyperlink — no plain handles.
- **Every named entity in 🔄 Patterns is hyperlinked** — issue numbers → issue URLs, reporter handles → their thread/issue, named surfaces/features → their canonical artifact. No bare `#NNNN`, handles, or feature names in Patterns prose.
- Forum thread URL: `https://discord.com/channels/<guild_id>/<thread_id>` (parent forum channel ID NOT in URL).
- Text channel: link to channel + include date.
- GitHub: `[#NNNN](issue-url)` + backtick handle; no profile link unless they have no filed issue.
- Append `🏢 <Company>` badge inline next to enterprise users' handles. Indie / solo get no badge.
- Identity collisions: merge same person across handles silently in the count; note inline if useful.
- Same-author duplicate-filing: one reporter, one signal.

## Substantive vs process notes

The report is **company-readable** (product, marketing, leadership, sales/CS, engineering). Strip orchestrator process notes:

**Forbidden:** "1 empty thread skipped", "X excluded per triage rules", "identity-merged", "just outside window — flag next week", "compare against prior weeks once N reports exist", "(2 CLOSED WONT_FIX promo)".

**OK to keep:** "Workaround stuck; real fix is PR #5300", "Zero-effort bonus: healed ~10 quickstart docs", "Hidden second bug: snapshot leak; needs own issue", **Action:** lines.

Test before publishing: read each parenthetical aloud and ask "would a non-engineer marketing person care?" If no, cut it.

## Conventions

- **Dated report lists go oldest → newest.** Front-door entries, reporter rosters, Resolved rows.
- **Report list bullets = one sentence.** Leading `**YYYY-MM-DD**` · source icon · linked reporter (+ 🏢 if enterprise) · one-line summary. Deep technical detail lives in 🔄 Patterns or the linked issue.
- Don't post to Discord — read only.
- Don't ping users by handle in Notion; summarize impact instead.
- Reconfirm window at start so Nathan can catch a wrong week before the page lands.
- Convert relative dates to absolute ISO so the page stays interpretable later.

## Cross-referenced skills

- `front-door-triage` — P0 categories and classification rules
- `deep-read-issue` — subagent flow for issue + fix PR deep read
- `enrich-reporter` — subagent for GitHub author enterprise enrichment
- `slack-tldr` — Slack JSON format + curl command
- `enterprise` — standalone enterprise view (run separately or invoked here)
- `topic-search` — ad-hoc cross-repo topic lookup
