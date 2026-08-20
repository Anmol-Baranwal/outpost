---
name: carry-forward-owners
description: After a weekly report is built, diff it against the PRIOR report to find items that appear in BOTH weeks, then print the Owner (and prospect "Passed to") value recorded last week so it can be carried forward. Print-only — never edits the owner fields; Nathan verifies and re-tags in Notion. Invoked by weekly-report near the end, and standalone on "carry forward owners", "who owned this last week", "owner continuity".
---

# Carry forward owners

An item that recurs week over week should not silently lose its owner. Every report ships with `**Owner:** _<blank>_` by design (Nathan assigns by hand), so a recurring item starts unowned each week even when someone was already on it. This skill closes that gap: find what recurred, report who had it, hand the list over.

**This skill PRINTS. It does not edit.** Never write an owner into a Notion page — Nathan verifies each row and re-tags himself. Writing owners automatically would launder an unverified match into an assignment.

## When to run

At the end of the routine, **after both report pages exist** (so the current-week items are final) and **before the Slack TL;DR and Loom** — an owner reassignment can change what the Loom says needs an owner. Also runs standalone against any two reports.

## Inputs

- **Current report:** the main page + AG-UI sub-page just published.
- **Prior report:** the most recent page under the Community Signals parent (`3673aa38-1852-80bc-a71f-d328d765668d`) *before* the current one — plus its AG-UI sub-page. Take the prior week by title date, not by list position.

## The matching key — use the canonical source, never the title

Titles get rewritten between weeks (deliberately — cards are re-worded as understanding improves), so **never match on card titles.** Match on the identifier in the **Source** line:

- GitHub → `<repo>#<number>`, e.g. `CopilotKit#6301`, `ag-ui#2300`. Normalise `ag-ui#NNNN`, `#NNNN` under an AG-UI page, and full URLs to the same key.
- Discord → the **thread id** from the URL (`discord.com/channels/<guild>/<thread_id>`).
- Reddit → the post's base36 id.
- **Prospects** → the person's GitHub login (stable), not the company name.

**One card can carry several keys** (a card citing two issues), and **one key can move sections** between weeks. Both are normal and both still count as a recurrence — a Top issue that becomes a Pain card is exactly the case this skill exists for.

## What to extract from the prior report

For every item, capture verbatim:

- every source key on the card
- the section it sat in, and its rank if it was a Top issue
- the **`Owner:`** value **character-for-character**, including any `<mention-user url="user://…"/>` tag — that tag is what Nathan re-pastes, so a paraphrase is useless
- the `Priority:` band
- for prospects, the **`Passed to (…)`** value, same verbatim rule

## Classify each owner value — they are not all assignees

| Prior value | Meaning | Carry forward? |
|---|---|---|
| A bare `<mention-user …/>` | A real assignee | **Yes** — carry it |
| `<mention-user …/>` + a note (e.g. "add to cycle planning triage") | Assignee + instruction | **Yes** — carry both, the note is context |
| A plain handle (`@nathan`) | A real assignee, typed not tagged | **Yes** — carry as written, flag that it's text not a Notion mention |
| `(reported by <mention-user …/>)` | **The REPORTER, not an owner** | **No** — never carry. Print it under "not an owner" so nobody re-tags a reporter as the assignee |
| `(unassigned)` / `_<blank>_` / empty | Nobody had it | **No owner to carry** — but see the escalation rule below |
| `Issue assigned to <mention-user …/>` on a prospect | Someone took the technical follow-up | Carry, and say it's the technical owner, distinct from the sales `Passed to` |

**When in doubt about whether a mention is an assignee, print it under "ambiguous" with the raw text and let Nathan decide.** A wrong assignment is worse than an unanswered question.

## Escalation: unowned across weeks

An item recurring with **no owner in either week** is its own finding: it has now survived a full cycle with nobody on it. Print those in a separate **⚠️ Unowned N weeks running** block with the number of consecutive weeks, and hand the list to the report's `Gaps & follow-ups`. This is often more actionable than the carry-forwards.

## Also report state changes on recurring items

A recurrence isn't always "still broken." For each match, say which it is:

- **Still open** → carry the owner.
- **Now in ✅ Resolved** → no owner needed; say so plainly so Nathan doesn't re-tag a closed item. Worth a line anyway: it tells him the previous owner's work landed.
- **Moved section** (Top issue → Pain, Pain → Resolved, Demand → Top issue) → name both sections; a de-escalation or escalation is context for whether the same owner still fits.
- **Priority changed** → note it; an owner assigned to a 🔴 may not be the right owner for a 🟢.

## Output format — print, don't write

```
## 🔁 Owner carry-forward — <current window> (vs <prior window>)

### Carry these owners forward
- **<repo>#<number>** — <short name>
  Last week: <section> (<rank if any>) · Owner: <VERBATIM owner value>
  This week: <section> · Priority <band> · <state note>
  → Re-tag: <the verbatim mention/handle to paste>

### ⚠️ Unowned N weeks running
- **<key>** — <short name> · unowned in <list of weeks> · this week <section>, Priority <band>

### Recurred but now resolved (no owner needed)
- **<key>** — <short name> · last week <section>, Owner <value> · now ✅ Resolved (<how>)

### Not an owner — do not re-tag
- **<key>** — prior value was `(reported by <mention>)`; that's the reporter

### Prospects
- **<login>** (<Company>) — last week Passed to: <verbatim> · this week <present/absent>

### No prior-week match
<count> items are new this week; nothing to carry.
```

Keep it scannable. Nathan reads this, checks the matches, and re-tags in Notion by hand.

## Accuracy rules

- **Verify every match by opening the identifier**, not by trusting a remembered number. A carry-forward onto the wrong issue puts a real person's name on work they never had.
- **Never invent an owner** because a card "looks like" someone's area.
- **Quote owner values verbatim.** `user://` ids are opaque; retyping one wrong silently tags the wrong person.
- **If the prior report can't be found or its owner fields are all blank, say so and stop** — don't fall back to guessing from the Gaps section or from Slack.
- **Two weeks is the default lookback.** Going further is fine when an item is old, but state which week each owner came from.

## Cross-references

- `weekly-report` — invokes this after the report-sources pass, before `slack-tldr` and `loom-walkthrough`
- `front-door-triage` — Priority bands, which decide whether a changed priority makes the old owner a poor fit
