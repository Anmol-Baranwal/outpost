---
name: deep-read-issue
description: Subagent flow for deep-reading GitHub issues + their linked/closing PRs to the bottom. Captures CURRENT state, maintainer status updates, reporter repro, blocking reviewer concerns, hidden second bugs, cross-repo duplicates. Invoked by weekly-report orchestrator; runs as a general-purpose subagent so the orchestrator's context stays small.
---

# Deep-read issue + linked PRs

## Accuracy is the whole job

The report is only as trustworthy as this step. The known failure mode: **reading the issue body (and maybe a few comments) and stopping there** — which misses that the issue was *closed*, that a maintainer said *"fixed in 1.60.1,"* that a *linked PR* already exists, or that the same bug is *open in the sibling repo*. Those misses put stale, wrong status in front of leadership.

**Four things are mandatory for every issue. Status is derived from these, never from the issue body alone:**

1. **CURRENT state, as of the run** — open / closed (+ `closedAt`, `stateReason`) / merged. Not the in-window snapshot. An issue created this week may already be closed.
2. **The full comment thread** — every human comment, read to the bottom. Capture maintainer status verbatim.
3. **The timeline → linked & closing PRs** — `gh issue view --comments` does NOT surface them. You must trace cross-references and closing PRs explicitly (commands below). Most status lives on the PR, not in the issue.
4. **Cross-repo duplicate check** — for runtime/browser/protocol bugs, the same root cause is often filed in BOTH `CopilotKit/CopilotKit` and `ag-ui-protocol/ag-ui`. Search the sibling repo for the error string.

## When to invoke

The orchestrator has a list of in-window issue numbers + fix-PR numbers across one or both repos. Spawn a `general-purpose` subagent with the prompt below.

## Subagent prompt template

```
You're producing the deep-detail substrate for a weekly community-signals report. Accuracy of STATUS is the priority — a wrong "still open / unfixed" is worse than a missing detail. Today's date: YYYY-MM-DD.

Repos: CopilotKit/CopilotKit and ag-ui-protocol/ag-ui
Window: Fri YYYY-MM-DD → Fri YYYY-MM-DD

## A. Issues — deep-read each to CURRENT status (not the in-window snapshot)

For EACH issue number, run ALL of these — do not stop at the body:

1. State + body + comments:
   gh issue view <num> --repo <repo> --json number,title,state,closedAt,stateReason,author,comments
   Read EVERY comment to the bottom.

2. Linked & closing PRs (the timeline — this is the step that gets skipped):
   gh issue view <num> --repo <repo> --json closedByPullRequestsReferences --jq '.closedByPullRequestsReferences'
   gh api repos/<repo>/issues/<num>/timeline --paginate --jq '.[] | select(.event=="cross-referenced" or .event=="connected" or .event=="closed") | {event, source: .source.issue.number, commit: .commit_id}'
   gh search prs "#<num>" --repo <repo> --state all --json number,title,state
   Then deep-read every PR you find (section B) — a fix usually lives here, even when the issue thread is empty.

Capture per issue:
- **STATUS AS OF <today>:** one line — open / closed(reason) / fixed-in-vX / merged-PR#N — derived from state + maintainer comment + linked PR, NOT from the body.
- Reporter's specific repro (commands, version, error string).
- **Maintainer status, quoted.** Any comment from a MEMBER / OWNER / COLLABORATOR (check authorAssociation) that states status — "fixed in 1.60.1", "closing, reopen if not", "this is a real bug", a Linear/ENT-#### ref, "PR up". Quote it with author + date.
- **Ignore the support bot for status.** `copilotkit-support-bot` / getorca "Recommended Solutions" are auto-generated guesses, NOT maintainer status or confirmation. Note bot advice only if a human endorsed it.
- Whether the *reporter* confirmed the fix (vs a maintainer closing speculatively).
- Cross-references (Discord threads, related issues, sibling-repo dup).

Numbers: <list>

## B. PRs — deep-read body + comments + reviews + files

For each PR found (flagged OR discovered via the timeline in A):
  gh pr view <num> --repo <repo> --json number,title,state,isDraft,mergedAt,reviewDecision,reviews,comments,author
  gh pr diff <num> --repo <repo> | head -200

Capture:
- **CURRENT state:** OPEN / DRAFT / MERGED <date> / CLOSED. reviewDecision is the source of truth for approval.
- **Review reality, not review count.** An APPROVED review from authorAssociation NONE is a drive-by, NOT a maintainer sign-off. Report `reviewDecision` (APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED) + who actually approved (association). "changes requested" can flip to "approved" within a window — report the LATEST.
- What the PR changes — file paths, function names. Tests added + what they cover.
- Whether it diverges from the reporter's ask.
- Procedural closures (branch-name/lint/CI) — NOT competing fixes; read the closing comment.
- One draft PR may close MULTIPLE issues (note it — they move together).

Numbers: <list> (plus any discovered in A)

## C. Cross-references + cross-repo duplicates

For each pair flagged "possibly same root cause" AND proactively for any runtime/browser/protocol error string:
- Search the sibling repo: gh search issues "<error string or symptom>" --repo <other-repo> --state all
- Quote the strongest evidence (stack trace, function name, error string).
- Verdict: same bug / different bug / one symptom of the other. If same bug across repos, note BOTH issue numbers and their states (one may be fixed while the other dangles).

## D. Hidden second bugs

Any issue body/comment burying a SECOND, larger bug — flag it, note whether any linked PR addresses it.

## Output

Structured markdown:
- ## A. Issue deep reads — one per issue, LEAD each with the `STATUS AS OF <today>:` line, then maintainer-status quote, repro, refs.
- ## B. PR deep reads — one per PR; state + reviewDecision + who approved (association); comparison table when 2+ target one issue.
- ## C. Cross-reference + cross-repo verdicts — evidence + both states.
- ## D. New facts the orchestrator didn't have — status changes, linked PRs, maintainer confirmations the body-only / Discord-only view would have missed.

Quote actual text for any status judgment (author + date). Don't summarize away version numbers, error strings, Linear refs, or who-approved. Under 2500 words.
```

## Why a subagent

A single issue + its linked PRs can be 5-10k tokens. Across 5-15 issues/week that's 50-150k tokens — it would crowd out the orchestrator's context. The subagent has its own window and returns ~1-3k tokens of synthesized, status-accurate substrate.

## Procedurally-closed PRs

When a fix PR was closed for a non-technical reason (branch-name violation, lint, CI flake) and the same author reopened the identical diff — count it as **one** fix attempt. Read the closing comment. Pulse "open fix PRs" should reflect distinct fixes, not raw PR count.

## What to surface in the orchestrator's report

- **Status line:** the `STATUS AS OF <today>` verdict — this is what determines whether an item is a Top issue, a Pain, or Resolved. A maintainer "fixed in vX" + closed issue = Resolved (with the version), never "unverified/dangling."
- **Symptom:** quoted technical detail (file paths, function names, error strings).
- **Fix PR:** marker (`OPEN` / `DRAFT` / `MERGED <date>`) + reviewDecision + whether the approver is a real maintainer. "No fix PR yet" only after the timeline scan in A came up empty.
- **Cross-repo:** if the same bug spans both repos, say so and give both states — don't report one half as open when the other is fixed.
- **Hidden second bug:** callout under the entry.
- **Action:** next step (nudge reviewer, land #X close #Y, file new issue, add the shipped-version comment on close).

## Accuracy checklist (run before returning)

- [ ] Every issue has a `STATUS AS OF <today>` line derived from state + maintainer comment + linked PR — not the body.
- [ ] Timeline/linked-PR scan run for every issue (not just the ones with obvious fix PRs).
- [ ] Every "still open / no PR / unfixed" claim re-checked against current state + timeline (this is where the wrong calls happen).
- [ ] Maintainer status quoted with author + date; support-bot text not mistaken for status.
- [ ] PR approvals checked for authorAssociation (drive-by NONE ≠ maintainer sign-off); latest reviewDecision used.
- [ ] Runtime/browser/protocol bugs checked for a sibling-repo duplicate.
