---
name: weekly-report
description: Fri→Fri community signals routine across CopilotKit + AG-UI. Orchestrator that supervises subagents — Discord pull, GitHub pull, deep-read, reporter enrichment, Reddit Pulse — and synthesizes a Notion report under the Community Signals parent page. Triggers on "go", "weekly report", "community signals", "run routine".
---

# Weekly community signals — orchestrator

You are the orchestrator. Your job is to **delegate the heavy work to subagents** so your context stays small, then synthesize their compact returns into the Notion report. Do not pull all Discord / GitHub / Reddit data into your own context.

## Maintaining these rules (meta-rule)

**Whenever the workflow gains or loses something — a section, a data source, a scoring change, a window change, a tool swap — update these skill rules in the SAME change, and clean them up.** Don't leave the old text sitting next to the new (that's how this file rots into contradictions). Remove the superseded rule, fix every place that referenced it (page-structure block, rendering rules, the relevant section spec, memory), and keep the file internally consistent. These skills are the source of truth for the manual routine until the native TS port lands ([#66](https://github.com/CopilotKit/outpost/issues/66)) — a rule that isn't written here doesn't exist.

## Output

A new Notion page under **Community Signals** parent (`3673aa38-1852-80bc-a71f-d328d765668d`) titled:

```
Weekly Community Signal — <Mon DD>-<DD>, <YYYY>
```

The main page is the **CopilotKit** report. It opens with the `## 📦 CopilotKit` header + a link to the AG-UI companion sub-page, then **leads the body with the cross-community `## 🔝 Top issues of the week`** (ranked), then the CopilotKit community sections, then the cross-community 🏢 Enterprise, 🟠 Reddit Pulse — CopilotKit, and 🔄 Patterns sections. **AG-UI always lives on its own sub-page**, created as a child of the main page and linked at the top (via a `<page url="…">` block). The AG-UI sub-page holds AG-UI's per-community detail — including its **own** `## 🔝 Top issues of the week — AG-UI` (AG-UI-scoped) and its own 🟠 Reddit Pulse — AG-UI section. The main page's Top issues are cross-community (and may include AG-UI front-door breaks); the cross-community Patterns takeaways stay on the main page.

Covering the **most recent complete Friday→Friday week** (Friday end-date inclusive) for Discord + GitHub. (Reddit Pulse uses a rolling 90-day window — see step 6.) State the window before pulling data.

## Orchestrator flow

1. **Determine the window.** Today's date → most recent complete Fri→Fri. State it.

2. **Spawn Subagent A — Discord pull.** Tell it to pull both servers:
   - CopilotKit (`1122926057641742418`): `#💬｜general` (text `1182553320540352563`) + `#🤔｜support` (forum `1313616713647919218`)
   - AG-UI (`1379082175625953370`): `#🔧-building` (text `1379082271642095738`) + `#✈️-support` (forum `1384529894972592158`)
   For forums use `mcp__discord__list_forum_threads` → filter to window → `mcp__discord__read_thread_messages` per in-window thread. **Read every thread to the bottom.** Return: compact per-channel substantive-message summary, with reporter handles + 1-line summaries. Skip hiring / self-promo / greetings (count them internally, but they only surface in Community ops if they rise to actual news — see "Community ops"; otherwise that section is omitted).
   **Capture resolution signal per thread:** a **green-check ✅** reaction, or an explicit accepted/"marked solved" / "issue has been resolved ✅" marker in the comments, means the answer was confirmed correct → the thread counts as **resolved** (feeds ✅ Resolved this week + the Discord-resolved count, see steps 9 and Pulse). Be strict — a reply, a 👍, or a ❤️ is NOT a resolution; only a green-check / accepted-answer marker is. Return each thread's status `RESOLVED (green-check)` / `OPEN`.

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
   An old front-door issue with in-window comment activity belongs in this week's report — in BOTH community reports if the broken artifact spans them (precedent: [ag-ui#1518](https://github.com/ag-ui-protocol/ag-ui/issues/1518), quickstart CLI broken since April, escalated via comment two months later; the failing `npx create-ag-ui-app` scaffold made it a CopilotKit front door too).

4. **Spawn Subagent C — Deep-read** (see `deep-read-issue` skill). For each in-window actionable issue + every detected fix PR. Returns: file paths, reviewer concerns, hidden bugs, test coverage, fix-PR scope.

5. **Spawn Subagent D — Enrich reporters** (see `enrich-reporter` skill). For every GitHub author across both repos + the prior-week roster. Returns: company affiliation table + enterprise list.

5b. **Spawn Subagent D2 — Deep-enrich prospects** (see `enrich-prospect` skill). AFTER D classifies the enterprise list, take the **prospect shortlist** (recognizable enterprise / well-funded scale-ups, e.g. Jasper AI / commercetools tier) and deep-enrich each: LinkedIn profile (employer verified against the GitHub company — keep searching if mismatched), company website, company size (ARR / latest funding round / employee count). Returns one structured block per prospect for the 🎯 Prospective enterprise customers subsection. Run on the shortlist ONLY, not every reporter.

6. **Subagent E — Reddit Pulse pull** (per-community, rolling 90-day window). Data source = the **`composio`** MCP server (Composio tool router, OAuth). See "Reddit Pulse section" for the full spec; the mechanics:
   - **Connection check.** Reddit needs an ACTIVE Composio connection. If `COMPOSIO_SEARCH_TOOLS` reports `has_active_connection: false` for `reddit`, call `COMPOSIO_MANAGE_CONNECTIONS` (toolkit `reddit`, action `add`), surface the returned auth link to Nathan, then `COMPOSIO_WAIT_FOR_CONNECTIONS`. If `composio` isn't connected at all → render "source not configured" and move on.
   - **Discover tools once:** `COMPOSIO_SEARCH_TOOLS` (keep the returned `session_id`, reuse it on every later Composio call).
   - **Window:** rolling **last 90 days**. Compute cutoff = now − 90d (epoch seconds); filter posts by `created_utc >= cutoff` client-side (Reddit search has no native date filter).
   - **Dedup ledger:** load `docs/community-signal/reddit-pulse-seen.json`. Skip any post `id` already listed. After the run, append ALL surfaced + dropped-as-noise ids under a new dated entry (so noise can't resurface), and prune ids whose post date is >90d old (they can't reappear in the window).
   - **Execute via `COMPOSIO_MULTI_EXECUTE_TOOL`** (batch independent calls in parallel; large responses save to the Composio sandbox — parse with `COMPOSIO_REMOTE_WORKBENCH`). Tools:
     - `REDDIT_SEARCH_ACROSS_SUBREDDITS` — one call per `REDDIT_BRAND_TERMS` entry (default `CopilotKit`, `AG-UI`, `ag-ui`), `restrict_sr=false`, `sort` new + relevance.
     - `REDDIT_RETRIEVE_REDDIT_POST` — per `REDDIT_WATCHLIST` subreddit (default LocalLLaMA, LangChain, AI_Agents, nextjs, SaaS, LLMDevs) for landscape/competitor chatter.
     - `REDDIT_RETRIEVE_POST_COMMENTS` — for high-signal / debatable threads; pass the **bare base36 article id** (no `t3_`). Top comments are the sentiment.
   - **Relevance filter:** keep only genuine CopilotKit/AG-UI posts. Drop false positives (e.g. the `jscpd` tool listing CopilotKit in a scanned-repo list) and ambiguous `ag-ui` matches — but still record their ids in the ledger.
   - **Classify per post** 👍 good / 🙂 mixed-positive / 😐 neutral / 🫤 mixed-negative / 👎 pain, from post + top comments. Flag competitor comparisons (LangGraph, Vercel AI SDK, assistant-ui, Vapi…) and recurring comment themes (e.g. "how is AG-UI different from Google A2UI?").
   - **For scoring (v2), fetch each distinct subreddit's recent `new` feed** (`REDDIT_RETRIEVE_REDDIT_POST` sort=new, ~30) → median of `(upvotes + 2·comments)` = the room baseline `M`. Needed for the reach weight + reception ratio (see "Reddit Pulse scoring algorithm").
   - **Split by community subject** (see "Reddit Pulse section") and **score each page 0–100** (see "Reddit Pulse scoring algorithm").
   Returns, per community: scored post list (`👍/🙂/😐/🫤/👎 · [title](permalink) · r/<sub> · ⬆score 💬comments · one-line`), the computed Pulse Score + band, an overall-vibe sentence, competitor + recurring-theme notes, and the list of ids to add to the ledger.

6b. **Spawn Subagent G — Release scan** (see `release-scan` skill). Spawn it **in parallel with Subagents A/B** (no other subagent depends on it; the fix-map is only needed by clustering/resolution). It pulls every CopilotKit + AG-UI release shipped in (and just after) the window, **diffs the git tags** — not the release notes, which are often empty stubs — to extract what each release fixed, and returns: the authoritative latest version per repo, the in-cycle release list, and a **fix-map** (`#NNNN · fixed in <version> · via PR #MMMM · what`). This is the source of truth for every version claim AND the input to the open-issue cross-check below.

7. **Cluster into Demand + Pain.** Per community. Apply threshold rule:
   - 2+ distinct people this week, OR
   - 1+ this week AND verifiable prior reference (issue #, thread ID, prior-report URL).
   Singletons → Early signals.
   **Override:** front-door categories skip threshold (see `front-door-triage` skill). Front-door / P0 items don't just headline their community — they feed the cross-community **🔝 Top issues of the week** ranking (see below), led by the biggest front-door break.

8. **Compute trend vs prior 7 days.** ↑ grew · ↓ shrank · → flat · ↑ new cluster.

8b. **Build the 📈 Trends strip** (see "Trends section"). ~12-week weekly series, cheap to compute:
   - **Issues filed / week** — bucket the last 12 Fri→Fri weeks. Per week, per repo: `gh issue list --repo <repo> --state all --search "created:<wk-start>..<wk-end>" --json number --jq 'length'`. Main page = CK + AG-UI combined per week; AG-UI page = AG-UI only.
   - **Issues resolved (closed) / week** — same buckets: `gh issue list --repo <repo> --state closed --search "closed:<wk-start>..<wk-end>" --json number --jq 'length'`. Pairs with filed for the filed-vs-resolved chart. **Watch for bulk-close outliers** (a single week with a 100s-of-issues sweep) — cap the bar + annotate, don't let it set the scale.
   - **Reddit mentions / week** — from Subagent E's 90-day pull (≈13 weeks), bucket the surfaced+deduped brand-term posts by `created_utc`. Usually sparse → render as a one-line note, not a weekly bar chart, unless volume justifies bars.
   - Hand the series to the synthesis as small integer arrays → render as ASCII bars in the collapsible Trends toggle. This week's row is the bottom; the strip is what makes "30 issues" read as up/down/flat and shows whether the backlog is growing.

9. **Detect resolutions.** Classify each in-window CLOSED GitHub issue: `FIX_PR_MERGED` / `BACKFILLED` / `FALSE_POSITIVE` / `DUPLICATE` / `WONT_FIX` / `CLOSED_NO_ACTION`. **Discord threads with a green-check ✅ / accepted-answer marker (step 2) are ALSO resolutions** — classify them `DISCORD_ANSWERED` and list them in ✅ Resolved this week alongside the GitHub closures. (A Discord thread can be resolved even when a related GitHub issue stays open — they're different tickets; resolve only what the green-check actually covers.)

9b. **Cross-check open issues against the release fix-map** (Subagent G). For every issue heading into Demand / Pain / Top issues / Early signals, check the fix-map. If it appears there, it shipped a fix we'd otherwise miss — **flag it inline, in place**: annotate `NOTE: appears fixed in vX.Y.Z (PR #MMMM) — verify` rather than silently reclassifying (a `Fixes #N` in a commit isn't always a complete fix; the human verifies before it moves to Resolved). Also stamp each `✅ Resolved this week` row with its `shipped in vX.Y.Z` from the fix-map.

10. **Fix-PR detection** for every issue mentioned (this week + carryover):
   ```
   gh pr list --repo <repo> --state all --search "fixes #<num> OR closes #<num>" --json number,title,state,url,isDraft,mergedAt
   ```
   Markers: `🛠️ Fix PR [#NNNN](url) OPEN` · `🛠️ Fix PR [#NNNN](url) MERGED <date>` · `🛠️ No fix PR yet.`
   Procedurally-closed PRs (branch-name violation etc.) don't count as competing fixes — read closing comment.

11. **Score & rank the Top issues** (see the ranking rubric in `front-door-triage`). First **record the naive order** — what you'd get ranking the candidates by loudness alone (engagement: 👍 + comments, recency, reporter count) — so the comparison page can show the delta. Then **score each candidate on the five axes** (surface tier · blast radius · severity · exposure · signal), using measurable inputs — `gh issue view --json reactionGroups,comments,labels`, fix-PR status from step 10, Discord distinct-reporter counts, and the enrichment. Sum, sort descending; the top 3–5 are the Top issues, ranked. Keep BOTH the scored table and the naive order — they get published in the ranking + comparison child pages (step 12). Community (CK vs AG-UI) is never an axis.

12. **Build the Notion pages** via `mcp__plugin_Notion_notion__notion-create-pages`. Create the AG-UI sub-page FIRST (as a child of the main page), then the main CopilotKit page references it at top with a `<page url="…">` block. **Then create the child pages** at the bottom of the main report (children of the main page):
   - **`📊 Top-issue ranking`** — the rubric + this week's scored table.
   - **`🔬 Ranking comparison — before vs after the algo`** — naive-by-loudness order vs scored order, with the delta + a "why it moved" note.
   - **`🟠 Reddit Pulse — scoring algorithm`** — the standing, public algo page (sentiment tiers, engagement weight, formula, bands, worked example). **Reuse the canonical one if it already exists** — link it, don't recreate it weekly (the algorithm is constant; only the worked example refreshes). Currently at `https://app.notion.com/p/3843aa38185281019809caf6af8efd67`.
   Link the ranking + comparison from a bottom line on both pages; link the algo page from each 🟠 Reddit Pulse section. See "Page structure", "Top-issue ranking child page", and "Reddit Pulse section" below.

   **Notion tooling gotchas (learned the hard way):**
   - `notion-create-pages` interprets `\n` / `\t` escapes correctly — author content with them.
   - `notion-update-page` `replace_content` / `insert_content` do **NOT** interpret `\n` / `\t` — they pass through as literal `n` / `t` and mangle the page. Use **real newline and tab characters** in `new_str`.
   - `notion-update-page` `update_content` (search/replace via `content_updates`) **does** interpret `\n` — handy for surgical inline edits and small block inserts. **Notion normalizes stored markdown** (strips blank lines between bullets, may split one link into two) — so always `fetch` the page and match the *current stored* text in `old_str`, not the text you originally wrote.
   - `replace_content` deletes any child page not referenced in `new_str`. To preserve sub/child pages, include their `<page url="…">` blocks in the new content (don't rely on `allow_deleting_content`).

13. **Draft Slack TL;DR** via `slack-tldr` skill. Save to `/tmp/slack-msg.json`. Show Nathan to review before he curls.

14. **Spawn Subagent F — link review (after the pages are built).** A dedicated review pass over both published pages. Two jobs:
   - **Coverage — every item has a source link.** Scan every Top-issue card, Demand/Pain bullet, Docs bullet, Resolved row, Reddit Pulse thread, Enterprise reporter, and Patterns entity. **Any item with no source link is flagged.** For each flagged item, hand it to a search retrieval pass (gh search for the issue/PR, Discord `list_forum_threads`/search for the thread, Composio for the Reddit permalink) to find the canonical link. If a link is found → add it. If none can be found → **the item does not stay on the page** (remove it). No bare claims survive. (See "Source links are mandatory".)
   - **Correctness.** For links that exist: every Discord thread URL's thread ID came from this run's pull (never memory/prior report) and the anchor matches the thread's title; every issue/PR number matches the title quoted next to it; every Reddit permalink is the one returned by Composio this run; external links (YouTube/Loom repro, docs) appear verbatim in the source — never reconstructed; anchor text names what the reader lands on.
   Returns: the flagged-item list + what was retrieved/removed. Re-run until zero linkless items remain.

15. **Generate the Loom walkthrough script + remind Nathan to record it — every report, no exceptions.** As the LAST step, invoke the `loom-walkthrough` skill to produce the 5–7 min radio-show script from the finished report (plain English, sounds ad-libbed, includes the CEO-level Pain read) so recording is painless. Then remind him to record. When he shares the link: add a `**Loom:** [Walkthrough](url)` line to the main page header (directly under the `**Week:**` line) and a `🎥 Walkthrough → <url|Loom>` line to the Slack message above the "Full report" link. Don't let the Slack message go out without asking about the Loom first.

16. **Update the ledger + the rules.** Write the run's surfaced + noise post ids into `docs/community-signal/reddit-pulse-seen.json`. And per the meta-rule at the top: if anything about the format changed this run, update these skill files in the same pass.

## Page structure

**MAIN PAGE — CopilotKit + cross-community Enterprise / Reddit / Patterns**

```
[H1 title]
**Week:** Fri YYYY-MM-DD → Fri YYYY-MM-DD     ← only line in the header block (+ **Loom:** line once recorded)

## 📦 CopilotKit                                ← community header, at the very top of the body
*↓ Companion report — the AG-UI half of this week is on its own page:*   ← italic label so the link reads as nav, not a heading
<page url="…">AG-UI sub-page title</page>      ← AG-UI sub-page link (give the sub-page a DISTINCT icon, e.g. 🔷, so it doesn't mirror the 📦 header)
---

## 📈 Trends {toggle="true"}                    ← collapsible context strip, cross-community. ONE ~12-week filed-vs-resolved table (Week · Filed · Resolved, counts + bars) + the per-community month-over-month table + a Reddit-mentions note. See "Trends section".
---

## 🔝 Top issues of the week                    ← THE LEAD body section — cross-community, ranked by importance. Each item a toggle: what · impact · fix plan · owner · priority, tagged [CK]/[AG-UI]. Lead with the biggest front-door break. See "Top issues of the week".
---

## 🏢 Enterprise                                ← ELEVATED — sits directly under Top issues (highlighted near the top, not buried). Cross-community. See "Enterprise section".
   ### 🚩 Enterprise questions & complaints     ← any enterprise-related question/complaint this week (e.g. threads/persistence = the "enterprise threads" tier). Each a card with owner + priority. Highlighted at the top of this section.
   ### 🎯 Prospective enterprise customers      ← community members who look like enterprise prospects (e.g. Jasper AI), each with a **Passed to (sales):** owner field. See "Prospective enterprise customers".
   ### Surfaces this week                       ← table: Enterprise Intelligence, CopilotKit Cloud, License onboarding, Security disclosure channel, Self-host runtime. Skip SSO/OAuth + Billing rows when no reports.
   ### Companies building on us this week       ← CURRENT-employer only; per-company bullets
   ### Enterprise-offering reactions            ← reaction to Slack / Teams / threads-persistence; state the silence explicitly when there's none
---

   ### 🔥 Demand                               ← CopilotKit community body; plain `###` header, each item a `#### {toggle}` card (see "Section item cards")
   ### 💢 Pain                                  ← plain `###` header, each item a `#### {toggle}` card (What/Impact/Fix plan)
   ### 📚 Docs                                  ← standing weekly section; plain `###` header, each item a `#### {toggle}` card (see "Docs section")
   ### ✅ Resolved this week                    ← XML table
   ### 📊 Pulse                                 ← this-window snapshot (filed + closed-out counts) + open fix PRs. Month-over-month table lives in 📈 Trends now. (see "Pulse section")
   ### Community ops                            ← OMIT ENTIRELY if nothing substantive (hiring/self-promo/greetings alone are NOT news — see "Community ops")
---

## 🟠 Reddit Pulse — CopilotKit · <band> NN/100 {toggle="true"}   ← CopilotKit-subject Reddit posts only, scored. Collapsible; score+band in the heading. (see "Reddit Pulse section")
---

## 🔄 Patterns — the takeaways                  ← ELEVATED + always-open, cross-community. The compressed read — what to act on. (Most-read section.)
## Gaps & follow-ups                            ← cross-community checklist
## Methodology                                  ← <details><summary> wrapped; threshold, window, sources
<page url="…">📊 Top-issue ranking</page>      ← child pages at the very bottom
<page url="…">🔬 Ranking comparison</page>
<page url="…">🟠 Reddit Pulse — scoring algorithm</page>
```

**AG-UI SUB-PAGE — same shape, AG-UI only**

```
[H1 title]
**Week:** Fri YYYY-MM-DD → Fri YYYY-MM-DD

## 🔷 AG-UI                                     ← community header (distinct 🔷 icon) at the very top of every AG-UI page
*↑ Companion report — the CopilotKit half of this week is the main page:*   ← italic nav label (mirrors the main page's companion link)
<page url="…main report…">CopilotKit main report title</page>             ← companion link BACK to the main page (every AG-UI page has one)
## 📈 Trends — AG-UI {toggle="true"}            ← collapsible context strip, AG-UI-scoped: ONE filed-vs-resolved table + per-community month-over-month table + Reddit-mentions note, ~12 weeks. (Enterprise + prospects stay cross-community on the main page — not duplicated here.)
---

## 🔝 Top issues of the week — AG-UI            ← AG-UI's OWN ranked list. AG-UI front-door breaks appear here AND on the main page; CopilotKit-only issues NEVER appear here. Same card format (### 1. … {toggle}, with owner + priority). Note "(also Top issue #N on the CopilotKit report)" on the shared ones.
---

   ### 💢 Pain                                 ← AG-UI community body; plain `###` header, each item a `#### {toggle}` card (see "Section item cards")
   ### 🔥 Demand                                ← plain `###` header, each item a `#### {toggle}` card
   ### 📚 Docs                                  ← plain `###` header, each item a `#### {toggle}` card
   ### ✅ Resolved this week
   ### 📊 Pulse
   ### Community ops                            ← OMIT ENTIRELY if nothing substantive (see "Community ops")
---

## 🟠 Reddit Pulse — AG-UI · <band> NN/100 {toggle="true"}   ← AG-UI-subject Reddit posts only, scored. (see "Reddit Pulse section")
---

## 🔄 Patterns — AG-UI                          ← AG-UI-scoped; points to the main "Patterns — the takeaways" for the cross-community read
## Gaps & follow-ups — AG-UI                     ← AG-UI-scoped checklist
## Methodology
<mention-page>📊 Top-issue ranking</mention-page>  ← bottom link to the main report's ranking child page
```

If a per-community subsection is empty, render "No X this week." Don't omit the heading. **Exception: Community ops is omitted entirely when there's nothing substantive** (see "Community ops" — hiring/self-promo/greetings alone are not news).

**Page split is mandatory, not conditional.** AG-UI always gets its own sub-page (even when thin); the main page is always the CopilotKit report. 🏢 Enterprise, 🔝 Top issues, and 🔄 Patterns — the takeaways are cross-community on the main page. 🟠 Reddit Pulse is split per community (each page scores its own posts). Gaps / Methodology are split per page; AG-UI keeps a short AG-UI-scoped Patterns that points back to the main takeaways.

**Order on the main page:** `## 📦 CopilotKit` header + companion link **first**, then `## 🔝 Top issues of the week`, then the CopilotKit community body. (There is no `## TL;DR` heading — that wrapper was removed; Demand/Pain/Docs/Resolved/Pulse/ops sit directly under Top issues. Front-door breaks are the Top issues, not a separate TL;DR line.) The AG-UI sub-page opens with its `## 🔷 AG-UI` header + companion link, then its **own** `## 🔝 Top issues of the week — AG-UI`.

**Sub-page naming.** Title the AG-UI sub-page `Weekly Community Signal — AG-UI — <Mon DD>-<DD>, <YYYY>`. Main page keeps `Weekly Community Signal — <Mon DD>-<DD>, <YYYY>`.

## Page rendering rules

- **Always-open sections:** Header, 📦/🔷 community header + companion link, 🔝 Top issues of the week, 🏢 Enterprise (all subsections), ✅ Resolved this week, 🔄 Patterns — the takeaways, Gaps & follow-ups. **Patterns is always open — never a `<details>`.** It's the most-read section.
- **📈 Trends is a collapsible heading toggle** (`## 📈 Trends {toggle="true"}`) — its whole body (both tables + notes) is **tab-indented** to nest inside the toggle. (Notion heading-toggles only collapse children that are indented; un-indented tables render outside the toggle.)
- **Toggle headings:** every Top-issue card (`### N. … {toggle="true"}`), **every item card in 🔥 Demand / 💢 Pain / 📚 Docs** (`#### … {toggle="true"}` — see "Section item cards"; the 🔥/💢/📚 section headers themselves are plain `###`, not toggles), and **each 🟠 Reddit Pulse section** (`## … {toggle="true"}`, with its score + band in the heading so it reads while collapsed). Card/body lines **tab-indented** to sit inside the toggle.
- **No 🚨 sirens on the Top-issue cards.** Rank them `### 1.` / `### 2.` … — the numbering carries the priority.
- **`<details><summary>` blocks:** Early signals, Pulse body, Community ops, Methodology. (Patterns is NOT one of these.)
- **Notion XML `<table header-row="true">…</table>`** form (not Markdown pipes) inside toggles/details.
- **Visual polish:** AG-UI sub-page gets a distinct icon (🔷) so its link doesn't read as a duplicate of the 📦 header; an italic "↓ Companion report" label sits above the link; `---` dividers between the top-level `##` sections to break up the column. (No table-of-contents — it ate too much vertical space.)

## Section item cards (the universal format)

Every reported item — in 🔝 Top issues, 🔥 Demand, 💢 Pain, and 📚 Docs — renders as a **self-contained toggle card**, never a run-on paragraph bullet. This is the format readers like on Top issues; it now applies to every section. A wall of prose in Pain (or anywhere) is the anti-pattern this replaces — if a reader has to parse a paragraph to find the impact, the card failed.

- **Section header stays a plain heading** (`### 🔥 Demand`, `### 💢 Pain`, `### 📚 Docs`). **Each item under it is its own toggle card**, one level down: `#### <short title> {toggle="true"}`. (Top issues are ranked one level up — `### N. <title> {toggle="true"}` — same card body.)
- **Card body = four tab-indented labeled lines**, bold labels, one sentence each — the **What** line, then a **CopilotKit version** line, then two more that adapt per section:

  | Section | Line 1 | Line 2 | Line 3 | Line 4 |
  |---|---|---|---|---|
  | 🔝 Top issues | **What** | **CopilotKit version** | **Impact** | **Fix plan** |
  | 💢 Pain | **What** | **CopilotKit version** | **Impact** | **Fix plan** |
  | 🔥 Demand | **What** | **CopilotKit version** | **Why it matters** | **Status** |
  | 📚 Docs | **What** (`Drift`/`Gap`/`Links-bot`) | **CopilotKit version** | **Impact** | **Fix** |

- **What** = the concrete thing, one sentence. **Impact / Why it matters** = who it hits and how bad / why we'd act. **Fix plan / Status / Fix** = shipped / in-progress / not-started + the PR or release (Pain, Top issues); requested / on-roadmap / workaround-exists (Demand); which doc to write or repair (Docs).
- **CopilotKit version — mandatory, sits directly below What, above Impact.** The version the reporter is on: pulled from the repro / issue body, or asked-for/answered in the comments (the `deep-read-issue` subagent captures it). Write it exactly, e.g. `**CopilotKit version:** v1.61.0`. **If no version is stated anywhere in the thread, write `**CopilotKit version:** unknown`** — never guess. This flags at a glance whether a reporter is on an old release and may just need to upgrade. For an AG-UI-native issue with no CopilotKit involved, use the AG-UI package version (e.g. `@ag-ui/langgraph 0.0.42`) or `n/a — AG-UI issue`.
- **Source link lives in the title or the What line** — mandatory, per "Source links are mandatory". Reporter handle hyperlinked.
- **Owner + Priority — a fourth meta line, mandatory on 🔝 Top issues and 🏢 Enterprise question cards** (optional elsewhere): `**Owner:** _<blank — Nathan fills>_ · **Priority:** 🔴 High / 🟡 Medium / 🟢 Low`. **Owner** = who drives the issue to the other side (maintainers / eng); left **blank** for manual assignment — never auto-name a person. **Priority** = derived from the front-door ranking score → H/M/L (see `front-door-triage` "Priority from rank"); set the band, overridable by hand.
- **One item, one card.** Don't merge two unrelated reports into one card; don't let a card spill past the three lines (+ the Owner/Priority meta line) — depth goes in the linked issue or in 🔄 Patterns.
- **Short title ≈ 3–6 words that name the thing** (`A2UI needs scaffolding`, not `Issue with A2UI`).

Sections that do NOT use this card format: ✅ Resolved (XML table), 🟠 Reddit Pulse (one-line post bullets), 📊 Pulse, Community ops, Early signals — these stay tables / one-liners / `<details>` as specified.

## Source links are mandatory

**Every item on the report carries a source link — no link, it does not get published.** This is a hard rule, not a preference. It applies to every Top-issue card, Demand/Pain bullet, Docs bullet, Resolved row, Reddit Pulse thread, Enterprise reporter, and every named entity in Patterns.

- The link points to the **canonical source**: GitHub issue/PR URL, the Discord forum-thread URL, or the Reddit permalink — wherever the claim originated.
- If you have an observation but no sourceable link, **do not write it as a bare claim**. Find the link, or leave it out. A claim with no source is flagged by the review agent (Subagent F, step 14) and either gets a link retrieved or is removed before publish.
- This is what the step-14 review pass enforces: it walks the finished pages, flags every linkless item, retrieves the missing link via search, and deletes anything that still can't be sourced.

## Top issues of the week (the lead body section)

The body **leads** with `## 🔝 Top issues of the week` — cross-community, directly under the CopilotKit header + companion link. Front-door breaks ARE the top issues, ranked together across both repos.

What goes in it (per leadership):
- **Not exhaustive — only what leadership should actually know.** 3–5 items, max. A quiet week can have fewer.
- **Ranked by importance.** Number them `### 1.` `### 2.` … Lead with the biggest front-door break — the surface the most users hit. A broken install/quickstart CLI (e.g. `npx create-ag-ui-app`) is a bigger front door than any single feature bug; an outage on the current release is front-page.
- **Each card is self-contained** — four lines:
  - **What:** the concrete failure.
  - **CopilotKit version:** the version the reporter is on (from repro / body / comments), or `unknown` — see "Section item cards".
  - **Impact:** who hit it and how bad.
  - **Fix plan:** shipped / in-progress / not-started + the PR or release. Call out **"fixed same day"** when true.
  - **Owner + Priority** (meta line): `**Owner:** _<blank>_ · **Priority:** 🔴 High / 🟡 Medium / 🟢 Low` — owner left blank for Nathan to assign; priority derived from the rank (see `front-door-triage` "Priority from rank").
- **Tag each `[CK]` / `[AG-UI]` / `[CK + AG-UI]`** and link the canonical issue.
- **Front-page items get the CI-gap takeaway.** If something big shipped broken, ask "how did this ship?" — usually a missing smoke test.
- The front-door P0 categories (`front-door-triage` skill) define what's *eligible*; the ranking decides what's *shown*.

**Per-page scope (both pages carry a Top issues list):**
- **Main (CopilotKit) page** — `## 🔝 Top issues of the week`, **cross-community**: ranks CK + AG-UI items together. An AG-UI front-door break can lead here.
- **AG-UI sub-page** — `## 🔝 Top issues of the week — AG-UI`, **AG-UI-only**: its own ranked list of AG-UI issues.
- **An AG-UI front-door issue appears on BOTH pages** (it's cross-community on the main list AND headline on the AG-UI list) — tag the shared ones "(also Top issue #N on the CopilotKit report)".
- **A CopilotKit-only issue NEVER appears on the AG-UI page.** (e.g. `#5533` agent-naming, `#5535` auth-header stay on the main page only.)
- Don't double-list an AG-UI Top issue in that page's Demand/Pain — elevate it to Top issues, leave the detail there (same as the main page).

**Community = the issue's subject, not the repo it's filed in.** A CopilotKit bug filed in the `ag-ui` repo (it targets/breaks CopilotKit) is a **CopilotKit** issue — count it on the CopilotKit side, never AG-UI, even though it was submitted in the wrong community. (And the reverse.) Precedent: `ag-ui#1891` "Illegal invocation" was filed in ag-ui but is a CopilotKit `HttpAgent` bug fixed in CopilotKit 1.60.1 → counted as CK, removed from AG-UI. **But ownership of the broken *tool* still decides it:** `create-ag-ui-app` failing is AG-UI's even though it scaffolds CopilotKit — the broken artifact is AG-UI's. Judge by *what is actually broken*, not which names are mentioned. This attribution applies everywhere (Top issues, clustering, enterprise counts, resolutions), not just Top issues.

## Top-issue ranking child page (public algo)

Every report ends with a child page — `📊 Top-issue ranking` — created as a child of the main page and linked from the bottom of both pages. It makes the ranking **auditable**.

Contents:
- **The rubric** — the five-axis scoring table (surface tier · blast radius · severity · exposure · signal) copied from `front-door-triage`, plus the "community is never an axis" + "fix status is a tag, not a demotion" rules.
- **This week's scored table** — one row per ranked candidate: `# · candidate (linked) · [CK]/[AG-UI] · surface · blast · severity · exposure · signal · TOTAL`, sorted by total. Note the measurable input behind any non-obvious score.
- **Tie-breaks** — note any (Blast radius, then Surface tier) so the order is fully reproducible.

**Companion `🔬 Ranking comparison` child page.** Shows the algo earning its keep: the **naive order** (rank by loudness) vs the **scored order**, as a `candidate | naive rank | algo rank | Δ` table, then a short "what changed, and why". When the order is unchanged, say so — that's the algo validating the read.

## Trends section (counts in context)

`## 📈 Trends {toggle="true"}` is a **collapsible** toggle, compact, sitting directly under the companion link, above 🔝 Top issues — so every number this week reads against its recent history. The point is context, not analysis: "is this a heavy week or a quiet one, and are we keeping up?" **Its whole body is tab-indented to nest inside the toggle** (see Page rendering rules — un-indented tables fall outside the collapse).

Contents, in order (whole body tab-indented to nest in the toggle):

1. **ONE weekly filed-vs-resolved table — `Week · Filed · Resolved (closed)`, ~12 weeks** (rolling, oldest → newest, newest row at the bottom + bolded). Each Filed/Resolved cell is `<count> <bar>` — the **number and the bar together**, `▓` filed · `▒` resolved. (Don't ship a number-less bar column — a bar with no number tells the reader nothing; that's why the old standalone "filed sparkline" + "Trend" column were dropped. One table, both series, numbers on every bar.)
2. **Month-over-month, per community** — `Community · Filed prev (<Mon YYYY>) · Resolved prev · Filed this (<Mon YYYY>, MTD) · Resolved this (MTD)` with a bold **Combined (CK + AG-UI)** row. The per-community + monthly cut the weekly table lacks; it lives **here in Trends**, not 📊 Pulse (moved 2026-06-30 to kill the duplicate filed-vs-resolved view). **Label the current month MTD** + note the cutoff (the month isn't over, so a drop vs last month is partly calendar). GitHub-only (Discord resolutions stay in ✅ Resolved). **Same combined table on BOTH pages** — don't split it per page.
3. **A Reddit-mentions note** (not a bar chart) — brand-term post counts are usually too sparse for weekly bars; state the rolling count and point to 🟠 Reddit Pulse.

- **One-line read under each table** — e.g. *"30 filed this week vs ~24/wk trailing — hot week"* and *"resolved ≥ filed the last 3 weeks — backlog shrinking."* State up/down/flat vs the trailing average; don't over-interpret. No percentage column — keep the cells to count + bar (a % vs-average column was considered and cut as clutter).
- **Cap bulk-close outliers.** A one-time mass-close (e.g. a 280-issue triage sweep in a single week) wrecks the resolved-bar scale — **cap the bar and annotate it inline** (`(1-time sweep)`), so it doesn't read as normal throughput.
- **Data** from orchestrator step 8b: filed = `gh issue list --search "created:<wk>"` per week; resolved = `gh issue list --state closed --search "closed:<wk>"` per week; both repos. Monthly table = same with month windows.
- **Scope:** the **weekly filed-vs-resolved table** is per-page — main page = CK + AG-UI combined, AG-UI sub-page = AG-UI-only. The **month-over-month table is the SAME combined table (CK · AG-UI · Combined rows) on BOTH pages** (per the "Same combined table on BOTH pages" rule above) — it is *not* scoped or split per page.

## Docs section (standing, weekly)

Every report carries a `### 📚 Docs` section per community, between 💢 Pain and ✅ Resolved. The header is a plain `###`; **each docs item is its own `#### {toggle="true"}` card** in the universal format (What / Impact / Fix — see "Section item cards"). The **What** line is prefixed with the item type:

- **Drift** — code moved, docs didn't.
- **Gap** — a needed guide that doesn't exist.
- **Links-bot** — dead doc URLs, support-bot citing 404s or stale answers.

(So a card reads: **What:** `Drift` — the React API surface… · **Impact:** … · **Fix:** rewrite the X page.)

Rules:
- **Every docs card carries a source link** (the issue/PR/Discord thread that raised it) — per the mandatory-source-link rule. A docs observation with no sourceable link doesn't get published; it's flagged for the review agent to source.
- A docs item that **blocks** a new/upgrading user is ALSO a Top issue — list it in both; in the Docs **Fix** line note "(blocking — also a Top issue)". Non-blocking docs items live only here.
- Always render the section; if empty, "No docs items this week."

## Community ops (conditional — omit when there's no news)

A `### Community ops` `<details>` block, but **only when there's something a company reader would actually care about** — a channel that needs moderation, a recurring spam wave, a process/access change, a genuinely notable community contribution. **Hiring posts, freelancer self-promo, and greetings are NOT news** — don't publish "6 people posted portfolios." If the only in-window non-substantive traffic is that kind of noise, **omit the Community ops section entirely** (no heading, no "nothing this week" line — just leave it out).

This is the one section that disappears when empty; every other section keeps its heading. The Discord pull still *counts* the skipped noise internally, but it only surfaces here if it rises to actual news.

## Pulse section (this-window snapshot)

The `### 📊 Pulse` `<details>` block on **each** page is a **point-in-time snapshot** (the over-time trends live in 📈 Trends now). In order:
1. This window's issue-filed count + a comment/👍 high note, **and the closed-out tally for the window**: GitHub issues closed this window + **Discord threads resolved (green-check ✅, step 2)**. State it as a number, e.g. "Closed out this window: 5 GitHub issues + 1 Discord thread (green-check)."
2. Open fix PRs (distinct fixes — see "Procedurally-closed PRs" in `deep-read-issue`).

**The month-over-month filed/resolved table moved to 📈 Trends** (2026-06-30) — it was the same filed-vs-resolved view as the Trends weekly table, just monthly, so it was redundant sitting in two sections. Pulse no longer carries it. The monthly-table mechanics (MTD labeling, `gh created:`/`closed:` per-month counts, Combined row on both pages) are specified under "Trends section".

## Reddit Pulse section (per community, 90-day, scored)

Reddit Pulse is the outside-the-walls read: what people say about CopilotKit / AG-UI on Reddit, good and bad. **It is split by community — each report page carries its own section, scored independently:**

- **`## 🟠 Reddit Pulse — CopilotKit`** on the main page (CopilotKit-subject posts).
- **`## 🟠 Reddit Pulse — AG-UI`** on the AG-UI sub-page (AG-UI-subject posts).

**Which page a post lands on — by primary subject:**
- Mentions **only CopilotKit** → CopilotKit section.
- About **AG-UI** (the protocol) → AG-UI section.
- Mentions **both** (common — AG-UI is CopilotKit's protocol) → the section matching the post's **primary subject** (e.g. "AG-UI is now an industry standard" → AG-UI even though CopilotKit is named; "CopilotKit building blocks" that mention AG-UI as the protocol it speaks → CopilotKit).

**Window:** rolling **last 90 days**, deduped against every post covered in prior weeks (ledger `docs/community-signal/reddit-pulse-seen.json`) so a thread is reported once — the week it first surfaces.

**Each section is a collapsible toggle** (`## 🟠 Reddit Pulse — <community> · <band> NN/100 {toggle="true"}`) with the 0–100 Pulse Score + band in the heading (so it reads while collapsed). Inside, tab-indented:
- the window/dedup note + a one-line link to the algo child page ("How this is scored → 🟠 Reddit Pulse scoring algorithm");
- a **Vibe** sentence (overall sentiment);
- scored post groups (**👍 Good** / **😐 Neutral / awareness** / **👎 Pain**), each post one bullet: `[title](permalink) — r/<sub> ⬆score 💬comments. one-line.`;
- a **🔁 Recurring** line for comment themes worth addressing (e.g. the A2UI-vs-AG-UI confusion);
- a closing `*Net: …· Pulse Score NN/100.*` tally.

Rules:
- **Every post is a source link** to its Reddit permalink. **Sentiment comes from reading the post + top comments** (`REDDIT_RETRIEVE_POST_COMMENTS`), not the title.
- **Cross-posts** of the same story merge into one bullet (note the copies + use max engagement).
- **Noise** (spam, false-positive keyword hits) is dropped from the section but still recorded in the ledger so it can't resurface.
- **Source-gated:** if the `composio` MCP / Reddit connection isn't available, render "🟠 Reddit Pulse — source not configured this week." and move on — never block the report on it.
- **Data source:** the **`composio`** MCP server (Composio tool router, OAuth — Composio's egress reaches Reddit where this machine's IP is 403-blocked). Connection managed via `COMPOSIO_MANAGE_CONNECTIONS` / `COMPOSIO_WAIT_FOR_CONNECTIONS`; tools discovered via `COMPOSIO_SEARCH_TOOLS` and run via `COMPOSIO_MULTI_EXECUTE_TOOL` (`REDDIT_SEARCH_ACROSS_SUBREDDITS`, `REDDIT_RETRIEVE_REDDIT_POST`, `REDDIT_RETRIEVE_POST_COMMENTS`). Scope vars `REDDIT_BRAND_TERMS` + `REDDIT_WATCHLIST` in the repo-root `.env`.

### Reddit Pulse scoring algorithm

Each section's 0–100 score is **calculated, not asserted**, and published on a standing public child page (`🟠 Reddit Pulse — scoring algorithm`) linked from each section. Community is never an input — each community is scored on its own posts.

**v2 (2026-06-19) — reach × reception.** v1 weighted by the post's own engagement only, so a win in a tiny sub outweighed a flop in a big one. v2 weights by the *room* and judges each post against that room's own norm:

- **Sentiment per post** `s` (from post + top comments): `+1` good · `+0.5` mixed-positive · `0` neutral · `−0.5` mixed-negative · `−1` pain.
- **Room baseline** `M` = median of `(upvotes + 2·comments)` over the subreddit's recent **`new`** posts (NOT `hot` — hot oversamples winners). Fetch ~30 per distinct sub. `M` is the room's activity proxy (quiet "<10 posts/day" sub → low `M`).
- **Reception** `ρ = (upvotes + 2·comments) / M`. `ρ ≥ 1` landed; `ρ < 0.3` flopped for that room.
- **Effective sentiment** `s'`: positive `s` → `s' = s · clamp(ρ, 0.3, 1.2)`; **positive big-room flop** (`M ≥ 10` and `ρ < 0.3` and `s > 0`) → `s' = 0`; `s = 0` → `0`; negative `s` → unchanged.
- **Reach weight** `W = log10(1 + M)` (quiet rooms barely move the score).
- **Score** `= clamp( 50 + 50 · Σ(s'ᵢ·Wᵢ) / Σ(Wᵢ) , 0 .. 100 )` (50 = neutral baseline).
- **Bands:** 🟢 75–100 · 🟡 50–74 · 🔴 0–49. Tunable knobs: `M ≥ 10` active-room threshold, `ρ < 0.3` flop line, `0.3–1.2` clamp.

**v3 (2026-06-29) — community-reception fix.** Three corrections after v2 mislabeled a modestly-positive AG-UI week as 🔴 (a positive post read as the biggest *negative*, and a self-published critique scored twice):

- **Subreddit eligibility — `r/u_*` user-profile feeds are NOT community rooms.** A self-post to your own profile has no community audience; it's self-promo, not reception. **Exclude profile-feed posts from scoring** (still record their ids in the ledger). Micro-subs are fine — they just carry tiny `W`.
- **Cross-post merge happens BEFORE scoring.** Identical story across subs counts **once** (max engagement), scored in the most-real sub it appeared in. A duplicate can never double a sentiment. (This was always the rendering rule; v3 makes it a scoring rule too.)
- **Positive big-room flop floors at neutral, never negative** (changed from v2's `s' = −0.25` to **`s' = 0`**). Under-performing a busy room removes a post's positive credit; it must not manufacture negativity. Otherwise a genuinely positive post in the highest-`W` room becomes the single biggest *negative* contributor — which is exactly the v2 bug. Negative `s` is still passed through unchanged.

When the algorithm changes, update the child page (don't recreate it) AND this section — per the meta-rule.

## Enterprise section (elevated, current-employer rule)

🏢 Enterprise is **cross-community and elevated to the top of the main page — directly under 🔝 Top issues, above the CopilotKit community body** (per Nathan: enterprise gets highlighted, not buried). Four subsections, in order:

**🚩 Enterprise questions & complaints** (highlighted first) — **any question or complaint this week that touches an enterprise surface or the enterprise offering**, gathered from GitHub + Discord + Slack. This is the catch-all so nothing enterprise hides in the general body.
- The **threads / persistence ("enterprise threads") tier** is enterprise by definition — a complaint about paying for threads, the persistence tier, or the self-host runtime belongs here, not just in Pain. (Precedent this cycle: the "threads off" / paid-persistence friction is an enterprise complaint.)
- Each item is a **card** in the universal format (What / Impact / Fix plan) **plus the Owner + Priority meta line** — owner blank for Nathan, priority derived from rank.
- Cross-reference, don't duplicate: if it's already a Top issue, list it here with a one-line pointer ("see Top issue #N") rather than repeating the full card.
- If there were none, say so explicitly: "No enterprise-specific questions or complaints this week."

**🎯 Prospective enterprise customers** (community-sourced) — see "Prospective enterprise customers" below.

**Companies building on us this week** — the signal is **a company currently using/building on us**, surfaced through someone who *currently* works there.
- **Verify the current employer** with `gh api users/<login>` AND read the bio — the `company` field is often stale. If the bio says "ex-", "previously", "prior experience: …", they do NOT count. (Precedent: a reporter showed `company: Apple` but bio said "Prior experience: Apple" — ex-Apple, dropped.)
- **Ex-employers and "notable individuals" don't count** — track them as community reporters, not enterprise.
- Per-company bullet: who, where they currently work, what they filed, and the strength of signal.
- When correcting a prior week's overcount, say so in a short `<details>` so the trend stays honest.

**Enterprise-offering reactions** — explicitly report community reaction to the enterprise surfaces, especially **Slack / Teams integrations** and **threads / persistence**. **If there was no reaction, say so** — silence is itself a signal.

### Prospective enterprise customers (community-sourced)

A standing subsection naming **community members who look like enterprise prospects** — people the sales team would want to know are in the community, building on us. This is a *lead list from the wild*, separate from "Companies building on us" (which is about who's already a confirmed current-employer signal).

- **Who qualifies:** someone active in Discord/GitHub/Reddit whose company is a recognizable enterprise/well-funded scale-up evaluating or building with CopilotKit/AG-UI — e.g. **Jasper AI** this cycle. Judge by the company, the depth of engagement, and the use case, not just a logo. When unsure, include with a "(worth a look)" note rather than dropping.
- **Deep-enrich every prospect via the `enrich-prospect` subagent** (spawn it once with the prospect shortlist — see that skill). It finds the LinkedIn profile, **verifies the LinkedIn employer matches the GitHub company** (keeps searching if it doesn't; never links a guess), and pulls the company website + company size. This is a *deep* pass — run it only on the prospect shortlist, not on every reporter (that's `enrich-reporter`).
- **One structured block per prospect** (from `enrich-prospect`):
  ```
  - **Issue:** [<GitHub issue title>](<issue url>)          ← use **Source:** [<thread/post>](<url>) for a Discord/Reddit-sourced prospect
    **Name:** [<Full Name>](<LinkedIn url>)                 ← or "<Full Name> — LinkedIn not confirmed" if it can't be verified
    **Company:** [<Company>](<company website url>)
    **Company Details:** <ARR / latest funding round only / employee count — most-recent only, or "size unknown">
    **Passed to (sales):** _<blank — Nathan fills>_
  ```
- **`Passed to (sales):` is a blank owner field** — never auto-name a person; Nathan tags whoever on sales he handed the lead to. Same manual-owner rule as the issue cards.
- **Identity accuracy over completeness:** a wrong LinkedIn link in a sales handoff is a real cost — when the LinkedIn↔company match can't be confirmed, write `LinkedIn not confirmed`, don't guess. Never fabricate a funding/ARR/employee number; use "size unknown (private, no public figures)".
- **Source link mandatory** (the `Issue:` / `Source:` link that surfaced them) — per the source-link rule. No source link → not published.
- If none this week: "No new community-sourced enterprise prospects this week."

## Patterns — the takeaways (elevated)

`## 🔄 Patterns — the takeaways` is **always open** (never a toggle/`<details>`) and sits cross-community on the main page. The compressed read of what to *act on*.

- Each bullet = one pattern, stated as a takeaway a busy exec can act on. Not "issue #X and #Y and #Z."
- Think: "truck coming," not "there's a green flower." Surface the thing that changes a decision.
- Every named entity hyperlinked (issues, handles, surfaces).
- 3–5 patterns.

## Reporter formatting

- Every Discord mention is a hyperlink — no plain handles.
- **Every named entity in 🔄 Patterns is hyperlinked** — no bare `#NNNN`, handles, or feature names in Patterns prose.
- Forum thread URL: `https://discord.com/channels/<guild_id>/<thread_id>` (parent forum channel ID NOT in URL).
- Text channel: link to channel + include date.
- GitHub: `[#NNNN](issue-url)` + backtick handle; no profile link unless they have no filed issue.
- Append `🏢 <Company>` badge inline next to enterprise users' handles. Indie / solo get no badge.
- Identity collisions: merge same person across handles silently in the count; note inline if useful.
- Same-author duplicate-filing: one reporter, one signal.

## Substantive vs process notes

The report is **company-readable** (product, marketing, leadership, sales/CS, engineering). Strip orchestrator process notes.

**Forbidden:** "1 empty thread skipped", "X excluded per triage rules", "identity-merged", "just outside window — flag next week", "(2 CLOSED WONT_FIX promo)".

**OK to keep:** "Workaround stuck; real fix is PR #5300", "Zero-effort bonus: healed ~10 quickstart docs", "Hidden second bug: snapshot leak; needs own issue", **Action:** lines.

Test before publishing: read each parenthetical aloud and ask "would a non-engineer marketing person care?" If no, cut it.

## Conventions

- **Dated report lists go oldest → newest.** Front-door entries, reporter rosters, Resolved rows, Reddit Pulse threads.
- **Report list bullets = one sentence.** Deep technical detail lives in 🔄 Patterns or the linked issue.
- Don't post to Discord / Reddit — read only.
- Don't ping users by handle in Notion; summarize impact instead.
- Reconfirm window at start so Nathan can catch a wrong week before the page lands.
- Convert relative dates to absolute ISO so the page stays interpretable later.
- **Never cite a CopilotKit (or AG-UI) version from memory — the `release-scan` subagent (step 6b) is the authoritative source.** Any "current release vX.Y.Z" / "fixed in vX.Y.Z" / "shipped in vX.Y.Z" claim uses that scan's latest/attributed version, never a remembered one. (If running outside the orchestrator, verify live: `npm view @copilotkit/react-core version` + `gh release list --repo CopilotKit/CopilotKit`; AG-UI: `npm view @ag-ui/core version` / `@ag-ui/langgraph` + `gh release list --repo ag-ui-protocol/ag-ui`.) A wrong version number is a credibility hit on the most-read card.

## Cross-referenced skills

- `front-door-triage` — P0 categories and classification rules
- `deep-read-issue` — subagent flow for issue + fix PR deep read
- `release-scan` — subagent: in-cycle release fix-map + authoritative version (open-issue cross-check)
- `enrich-reporter` — subagent for GitHub author enterprise enrichment (shallow: company field → 🏢 badge, all reporters)
- `enrich-prospect` — subagent for DEEP enterprise-prospect enrichment (LinkedIn + company website + size; prospect shortlist only)
- `slack-tldr` — Slack JSON format + curl command
- `loom-walkthrough` — the 5–7 min radio-show walkthrough script, generated after every report (last step)
- `enterprise` — standalone enterprise view (run separately or invoked here)
- `topic-search` — ad-hoc cross-repo topic lookup
