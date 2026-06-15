---
name: deep-read-issue
description: Subagent flow for deep-reading GitHub issues + fix PRs to the bottom. Captures reporter repro, blocking reviewer concerns, hidden second bugs, test coverage, fix-PR scope. Invoked by weekly-report orchestrator; runs as a general-purpose subagent so the orchestrator's context stays small.
---

# Deep-read issue + fix PRs

## When to invoke

The orchestrator (or any caller) has a list of in-window issue numbers + fix-PR numbers across one or both repos (`CopilotKit/CopilotKit`, `ag-ui-protocol/ag-ui`). They need technical depth that would blow up the main context if read inline. Spawn a `general-purpose` subagent with this prompt template.

## Subagent prompt template

```
You're producing the deep-detail substrate for a weekly community-signals report.

Repos: CopilotKit/CopilotKit and ag-ui-protocol/ag-ui
Window: Fri YYYY-MM-DD → Fri YYYY-MM-DD

## A. Issues to deep-read (full body + every comment)

For each: `gh issue view <num> --repo <repo> --comments`

Capture:
1. Reporter's specific repro (commands, version, error string)
2. Every substantive comment (skip "+1" / "same here")
3. Whether the reporter confirmed a fix
4. State transitions visible in comment log
5. Cross-references (Discord threads, related issues)

Numbers: <list>

## B. Fix PRs to deep-read (body + comments + files changed)

For each:
  gh pr view <num> --repo <repo> --comments
  gh pr diff <num> --repo <repo> | head -200

Capture:
1. What the PR actually changes — file paths, function names
2. Reviewer concerns (especially BLOCKING ones — quote them)
3. Tests added (and what they actually cover)
4. Whether the PR diverges from the reporter's ask
5. Procedural closures (branch-name violations etc.) — these are NOT competing fixes; read the closing comment

Numbers: <list>

## C. Cross-references to verify

For each pair the orchestrator flagged as "possibly same root cause":
- Quote the strongest line of evidence (stack trace, function name, config option, error string)
- Verdict: same bug / different bug / one symptom of the other

## D. Hidden second bugs

For any issue body containing a SECOND, larger bug the reporter mentioned as an aside — flag it. None of the linked PRs may address it. Format inline:
  "The reporter buried a second, larger bug inside the same report: <quote>. None of the linked fix PRs addresses this — needs its own issue."

## Output

Structured markdown:
- ## A. GitHub issue deep reads — one subsection per issue
- ## B. Fix PR deep reads — one per PR, with comparison table when 2+ PRs target the same issue
- ## C. Cross-reference verification — verdict + evidence per pair
- ## D. New facts the orchestrator didn't have — anything in PR descriptions, reviewer comments, or commit messages that the Discord-only view would have missed

Quote actual text where it informs a judgment call. Don't summarize away technical detail — file paths, function names, error strings, version numbers, blocking reviewer concerns.

Under 2500 words.
```

## Why a subagent

A single issue + its fix PR can be 5-10k tokens of full body + comments + diff. Multiplied across 5-15 issues per week, that's 50-150k tokens. Reading inline in the orchestrator's main context would crowd out everything else.

Subagent has its own context window. Returns a compact structured report (~1-3k tokens). Orchestrator consumes only the synthesized output.

## Procedurally-closed PRs

When a fix PR was closed for a non-technical reason (branch-name violation, lint issue, CI flake) and the same author reopened the identical diff as a new PR — count B+C as **one fix attempt**, not two. Read the closing comment. If it says "closing to reopen from a properly-named branch" or similar, the real competition is only between the technically-distinct attempts.

Pulse "open fix PRs awaiting review" count should reflect distinct fixes, not raw PR count.

## What to surface in the orchestrator's report

The subagent's output feeds these report fields:

- **Symptom:** quoted technical detail (file paths, function names, error strings)
- **Fix PR:** marker (`OPEN` / `MERGED <date>` / `No fix PR yet.`) + which PR wins if competing
- **Hidden second bug:** callout block under the front-door / pain entry
- **Action:** next step engineering should take (nudge reviewer, land #X close #Y, file new issue for hidden bug)
- **Zero-effort bonus:** if a merged PR silently fixed more than the reporter asked
- **Comment on issue close with shipped release version:** Gaps follow-up whenever a fix PR merged in-window
