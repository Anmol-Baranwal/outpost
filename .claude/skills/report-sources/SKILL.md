---
name: report-sources
description: Builds the "Report Sources" child page for a finished Weekly Community Signal report — an evidence-backed defense of WHY every item landed in the column/section/rank it did. The agent argues each placement like a lawyer (claim → evidence → rule → rebuttal) but is under oath: it CANNOT invent, spin, or overstate — every claim ties to a verifiable fact (issue #, label, PR type, quoted comment, npm output, the front-door test). Not CYA — it's so Nathan can defend the report with facts and see the exact reasoning behind each call. Runs after the report (invoked by weekly-report, last steps) and on "report sources", "defend the report", "why is this here".
---

# Report Sources — the defense of every placement

For each finished report, produce a child page titled **"Report Sources"** that defends, with evidence, why every item is where it is. Nathan reads it to know — with facts — exactly why each issue was ranked, columned, attributed, or resolved the way it was, so he can defend the report to anyone.

## The lawyer's brief (education + the oath)

Argue each placement the way a good litigator does — but **an honest one who cannot lie, and who tells the client the weaknesses too.**

- **Structure every defense as:** **Claim** (where it landed) → **Evidence** (verifiable facts) → **Rule** (which report rule that evidence satisfies) → **Rebuttal** (the strongest counter-argument + why it fails or, if it doesn't, concede) → **Confidence**.
- **Under oath — the hard constraints:**
  - **Every factual claim must cite a verifiable source** — issue/PR URL, a *quoted* label or comment (with author + date), a PR's conventional-commit type (`feat`/`fix`), `npm view` output, the reporter's stated version, engagement counts from `gh ... reactionGroups,comments`, the enrichment result. No claim floats free.
  - **No invention, no spin, no overstatement.** If a fact isn't in a source, it doesn't go in the brief. Don't dress up a weak call as strong.
  - **Separate FACT from JUDGMENT explicitly.** "Fact: PR #2076 is titled `feat(adk):` and labeled `enhancement`. Judgment: therefore feature-request, so → Demand."
  - **Concede weaknesses.** An honest lawyer flags the shaky parts. If a placement is a judgment call or the evidence is thin/ambiguous, say so and give the honest confidence — "placed X; defensible but not airtight because Y; the alternative reading is Z." This is the opposite of CYA — surfacing the weak points is the job.
  - **Never state a maintainer "confirmed" unless a maintainer actually said so** (quote it). Same bar as `deep-read-issue`.

## What must be defended (every classification decision)

For each item in the report, defend the placements that apply to it:

- **Front-door: yes/no.** State the **front-door test** result with evidence — *does it block the documented quickstart / getting-started or a core integration the general audience hits?* Quote the repro / docs that decide it. (Worked precedent: `ag-ui#2067` = narrow, because `fastapi` is optional and the served quickstart installs it; the crash only hits the no-`[fastapi]` in-process path.)
- **Top-issue rank + priority.** Reproduce the **five-axis score** (surface · blast · severity · exposure · signal), each axis tied to its measurable input (labels, engagement counts, fix-PR status, enterprise reporter, age). Show the sum and why it sits at that rank; note the tie-break if one applied.
- **Section: Top issue vs 💢 Pain vs 🔥 Demand vs 📚 Docs.** Defend **bug vs feature-request** with the tell (a `feat`/proposal PR or Feature/RFC title/`enhancement` label ⇒ feature ⇒ Demand; a `fix` PR / `[Bug]` / crash language ⇒ bug). If it was `UNSURE`, say so.
- **Community attribution (CK vs AG-UI).** Defend by **subject, not repo** — quote what's actually broken / which product's release fixed it. Flag any mis-filed issue and why it was re-attributed.
- **Resolved.** Defend the resolution class (`FIX_PR_MERGED` / `DISCORD_ANSWERED` green-check / etc.) with the merged-PR link + date or the green-check evidence, and the shipped version from the release-scan.
- **Enterprise classification + prospect.** Defend current-employer (not "ex-"), and for prospects the LinkedIn↔company match (or the honest `LinkedIn not confirmed`) + the size source.
- **Maturity flag.** Defend any experimental/deprecated/pre-release flag with the npm fact (e.g. `npm view @copilotkitnext/core deprecated`).

## Page shape

Child page **"Report Sources"** under the report (one per page — main report gets one; the AG-UI sub-page gets its own, or a single combined one that covers both, whichever the orchestrator chooses — default: one per report page, each defending that page's items).

- Open with a one-line **standard of proof** note: *"Every claim below cites a verifiable source; judgment calls are marked, and weak spots are conceded — this is an evidentiary record, not spin."*
- **One entry per item**, keyed by the item's title + where it landed. Use a toggle per item so the page scans:
  ```
  ### [<item>] → <placement> {toggle="true"}
  	**Claim:** <where it landed + rank/priority/section>.
  	**Evidence:** <facts, each with a link or quote>.
  	**Rule:** <the report rule the evidence satisfies>.
  	**Rebuttal:** <strongest counter + why it fails, or concession>.
  	**Confidence:** <high / medium / low + the honest caveat>.
  ```
- Group entries by report section (Top issues, Pain, Demand, Docs, Resolved, Enterprise) so it mirrors the report.
- **Every link is real** (same mandatory-source-link rule as the report). A defense with an unverifiable "fact" is struck — remove it or downgrade to a stated judgment.

## Findings feed back into the report — ALWAYS fix, never just flag

**If the defense uncovers a discrepancy, the REPORT is corrected first — then the defense reflects the corrected report.** The Report Sources page defends the *final, accurate* report; it must never sit next to a report it just proved wrong. This is the whole point: the lawyer is a last verification pass, not a place to park known errors.

- When an entry's evidence doesn't support the placement as written — wrong resolved class or date, wrong community attribution, a stale version, a rank whose axis inputs don't add up, a "fixed" with no merged PR, an enterprise claim that doesn't hold — **fix the report item first** (correct the cell/card/section/rank on the Notion page), **then** write the defense against the corrected state.
- **The defense entry states the corrected fact, not the old one.** Don't write "the report says X but it's really Y" as the final record — fix X→Y in the report, then defend Y. (It's fine to note "corrected during the sources pass" when the correction is material, so the change is traceable.)
- **Loop until zero unresolved discrepancies.** Re-check after fixing; the pass isn't done while any Report Sources entry contradicts the report.
- If a discrepancy can't be resolved (the fact is genuinely unknowable), the *report* is softened to match the evidence (e.g. drop a false "merged PR" claim to "closed, no linked PR") — the report never keeps a claim the defense can't stand behind.

## When it runs

- **Invoked by `weekly-report`** as one of the final steps (after the link-review pass, alongside the Loom script) — build a "Report Sources" child page for the main report (and the AG-UI sub-page).
- **Standalone:** "report sources", "defend the report", "why did X land in Y".
- Runs as a **general-purpose subagent** (it re-reads sources to cite them) so the orchestrator's context stays small; the orchestrator just creates the returned page.

## Cross-references

- `front-door-triage` — the front-door test + five-axis rubric being defended
- `deep-read-issue` — the source-of-truth facts (status, TYPE, version, maturity) each defense cites
- `enrich-prospect` / `enrich-reporter` — the enterprise facts defended
- `weekly-report` — invokes this; carries the "Report Sources" child-page slot in the page structure
