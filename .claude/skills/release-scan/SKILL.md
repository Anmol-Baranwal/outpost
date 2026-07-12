---
name: release-scan
description: Subagent that scans CopilotKit + AG-UI releases shipped in (and just after) the report window, diffs the git tags to extract what each release actually fixed, and returns a fix-map the weekly-report writer cross-checks against open issues. Catches issues that are quietly already-fixed in a shipped release, and is the authoritative source for the "current release vX.Y.Z" version claims. Invoked by weekly-report (spawned in parallel with the Discord/GitHub pulls); runs as a general-purpose subagent so the orchestrator's context stays small.
---

# Release scan (subagent)

Pull every CopilotKit + AG-UI release in the cycle, work out **what each one actually fixed**, and hand back a compact **fix-map** plus the authoritative **latest version** per repo. The weekly-report writer uses this two ways: (1) cite versions that are 100% correct, and (2) catch issues we'd otherwise mark OPEN that have quietly already shipped a fix.

Runs as a **subagent** spawned by `weekly-report` **in parallel with** the Discord + GitHub pulls (Subagents A/B). No other subagent depends on it; the orchestrator only needs the fix-map by the clustering/resolution step.

## Why this exists

A wrong "current release vX.Y.Z" on the lead Top-issue card is a credibility hit, and an issue we headline as "open, no fix" that actually shipped a fix two days ago makes the whole report look stale. Both are avoidable by reading the releases.

## The #1 mechanical rule: diff the tags, don't trust the notes

**Release notes are frequently empty stubs.** Real example (week of 2026-06-19→26): `v1.61.0` had full notes, but `v1.61.1` and `v1.61.2` both had bodies that read only `Release v1.61.x`. A notes-only scan would have reported "nothing fixed" for two of three releases.

So the source of truth is the **git tag diff + commit/PR parse**, not `gh release view` bodies. Read notes when they exist (they're nicer prose), but **always** back them with the diff.

## Window

- **Releases to include:** every release published from the **last release BEFORE the window start** up to the **latest release available now** — even if the latest is a day or two *after* the window's Friday. Fixes for in-window issues routinely ship a few days later; including them is the point.
- Get the boundary tags, then compare.

## Repos, tags, packages

| Repo | Release tag shape | Authoritative version source |
|---|---|---|
| `CopilotKit/CopilotKit` | semver `vMAJOR.MINOR.PATCH` (e.g. `v1.61.2`) | `npm view @copilotkit/react-core version` + `gh release list` |
| `ag-ui-protocol/ag-ui` | date tags `release/YYYY-MM-DD` (e.g. `release/2026-06-24`) | `npm view @ag-ui/core version`, `npm view @ag-ui/langgraph version` + `gh release list` |

Note AG-UI ships several sub-packages on independent versions (`@ag-ui/core`, `@ag-ui/client`, `@ag-ui/langgraph`, `@ag-ui/a2ui-middleware`…). A langgraph-only bump (e.g. `@ag-ui/langgraph` 0.0.41→0.0.42) is exactly the kind of thing that fixes a reported langgraph issue — report per-package, not one blob.

## Procedure

1. **List releases + find boundaries.**
   ```
   gh release list --repo CopilotKit/CopilotKit --limit 12
   gh release list --repo ag-ui-protocol/ag-ui --limit 12
   ```
   Identify `<prev>` (last release before window start) and `<latest>` (newest now) per repo.

2. **Confirm the live latest version** (this is the value the writer cites):
   ```
   npm view @copilotkit/react-core version
   npm view @ag-ui/core version ; npm view @ag-ui/langgraph version
   ```
   Use the highest released semver. Never a remembered one.

3. **Diff the tags and extract fixed issues** — the core step:
   ```
   gh api repos/CopilotKit/CopilotKit/compare/<prev>...<latest> --jq '.commits[].commit.message'
   gh api repos/ag-ui-protocol/ag-ui/compare/<prev>...<latest> --jq '.commits[].commit.message'
   ```
   From the commit messages, capture every `Fixes #N` / `Closes #N` / `Resolves #N` (case-insensitive) and every `(#PR)` reference. For squash-merged PRs the message holds both the PR number and the `Fixes #N`. When a commit cites a PR but no issue, fetch the PR to recover the closed issue:
   ```
   gh pr view <pr> --repo <repo> --json title,closingIssuesReferences,mergedAt,url
   ```
   Attribute each fix to the release whose tag contains its merge (use the per-release compare `<v_{n-1}>...<v_n>` when you need to know *which* version shipped it).

4. **Map notes when present** (CopilotKit point releases often have none — that's expected):
   ```
   gh release view <tag> --repo <repo> --json publishedAt,body
   ```

## Return (compact — feeds a limited-context orchestrator)

- **Latest version per repo** (CopilotKit semver; AG-UI per-package), each with its publish date. Flag if the latest shipped *after* the window's Friday.
- **Releases in cycle:** `<tag> · <date> · 1-line headline (or "stub notes — diffed")`.
- **Fix-map** — the payload the writer cross-checks. One row per fixed issue:
  `#NNNN · fixed in <version> · via PR #MMMM · <repo> · 1-line what`.
  Group CopilotKit vs AG-UI.
- **Notable unattributed fixes** — security/correctness fixes in the diff with no issue number (e.g. a Markdown-XSS sanitize, a reconnection-state fix). List them; they may match a Discord-only pain item that has no GitHub issue.
- **Cross-check candidates** — if you were given (or can see) the week's open-issue list, pre-flag any that appear in the fix-map: `#NNNN we'd mark OPEN appears fixed in <version> — verify`.

## How the writer uses the fix-map (in `weekly-report`)

- **Version claims:** every "current release vX.Y.Z" / "fixed in vX.Y.Z" line uses this scan's latest/attributed version. No memory.
- **Open-issue cross-check:** for every issue heading into Demand / Pain / Top issues / Early signals, check the fix-map. If it's there, **flag it inline, in place** — annotate `NOTE: appears fixed in vX.Y.Z (PR #MMMM) — verify` rather than silently moving it. The human verifies before it's reclassified (a `Fixes #N` in a commit isn't always a complete fix). Don't auto-move to Resolved.
- **Resolved rows carry the shipping version:** add `shipped in vX.Y.Z` to each `✅ Resolved this week` row, sourced here.

## Cross-references

- `weekly-report` — orchestrator; spawns this in parallel with the Discord/GitHub pulls and carries the cross-check + version-citation rules.
- `deep-read-issue` — per-issue fix-PR detection; release-scan is the complementary *shipped-release* view (did the merged PR actually make it into a tagged release?).
