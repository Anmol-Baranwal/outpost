---
name: loom-walkthrough
description: Generate the 5-7 minute Loom walkthrough script for a completed Weekly Community Signal report — a plain spoken briefing that notifies the team of the week's highlights and what the host needs to flag. Straightforward and factual, NOT a radio show or a performance. Runs after every report (invoked by weekly-report) and on "loom script", "walkthrough script", "record the loom", "narrate the report".
---

# Loom walkthrough script

Turn a finished Weekly Community Signal report into a spoken briefing the host can record with confidence. **This is a plain internal update — the host is notifying the team of the week's highlights and what needs flagging, not putting on a show.** The host doesn't know the engineering deeply, so every line must be in plain "what it means for us" English, never internals.

This runs **after every report** — the `weekly-report` orchestrator invokes it once both pages are published, and it's independently triggerable ("loom script", "record the loom").

## Mandatory: the script MUST cover the AG-UI page

The report is **two pages** — the main page (CopilotKit) and the AG-UI sub-page. **The script must walk BOTH.** A script that only covers the CopilotKit page is incomplete and must not be delivered. Segments 7–9 are the AG-UI page (top issues, pain, momentum); open them with a `[SWITCH to the AG-UI sub-page]` cue and a spoken transition so the viewer knows the page changed. Even a thin AG-UI week gets covered (compress, don't skip). This is non-negotiable.

## Tone: a plain briefing, not a performance

This is an internal report-out. The host is telling the team the week's highlights and what they need to flag — nothing more. Keep it neutral and factual. **No cheeky openers, no radio-show energy, no jokes, no dramatic asides, no manufactured suspense.** If a line sounds like entertainment, cut it.

- **Straightforward and plain.** State the thing, its status, and whether it needs attention. The host is notifying, not narrating a story.
- **Still easy to read aloud** — contractions and short sentences are fine (it's spoken, not a memo), but the register is a calm colleague giving an update, not a presenter.
- **Open with the single most important thing** — the biggest highlight or the biggest flag, said plainly. No "hook," no rotating gimmick, no callback bit.
- **No on-camera meta.** Don't narrate the document's structure — no "in this report," "next section," "as you can see." Just say what happened.
- **No catchphrase / no through-line slogan.** Don't invent a theme to repeat. If there's a genuine pattern worth naming, state it once, plainly, where it's relevant.
- **Numbers spoken, not written.** "about two months," "fifty out of a hundred" — never "~2mo" or "50/100" in the spoken lines.
- **Stage directions live in a hidden sidebar** (`[SCROLL to …]`, `[beat]`, time markers) — clearly separated so the host reads them silently and never speaks them. They are cues, not lines.

## Top issues are numbered — one beat each, never a paragraph

The Top issues are the core of the briefing. Deliver them as a **numbered list matching the report's ranking** — "number one … number two … number three …" — each its **own short beat** with a `[beat]` between. **Never blur two or more top issues together into one paragraph.** Each beat says, plainly: what the issue is (user-facing), and its status (fixed / fix in progress / not started). Give each its own time marker so the host paces one at a time. If a top issue is AG-UI-scoped, still number it here, and note you'll revisit it on the AG-UI page.

## Length

**5–7 minutes** (~800–1100 spoken words). Mark rough time stamps so the host can pace. Always include a "to hit 5 minutes, cut these" note listing the 2–3 most trimmable lines.

## Segment flow (adapt to the week — don't force empty ones)

1. **Open** (~15s) — lead with the single most important thing this week (biggest highlight or biggest flag), said plainly. No hook, no gimmick.
2. **The week in one line** — the one-sentence takeaway + anything the team should watch. The TL;DR spoken aloud, plainly.
3. **Top issues — NUMBERED, one beat each** — deliver the report's ranked top issues as a numbered list ("number one … number two …"), each its own short beat with a `[beat]` between, each with its own time marker. Per issue: what it means for a user + status (fixed / fix in progress / not started). Never how it broke internally, and never blur two into one paragraph. (See "Top issues are numbered" above.)
4. **Pain — the high-level read (the CEO segment — slow down here).** NOT issue-by-issue. Name *where people are struggling* as a pattern, per community, plus the one structural pain. The CEO wants the shape of the hurt, not a bug list. (See "Pain segment" below.)
5. **Enterprise** — count + trend + the one-line "how they showed up / what to do."
6. **CopilotKit Reddit** — score + one-phrase vibe (trimmable).
7. **AG-UI — top issues** — same plain treatment; flag the one that matters most. **This is a SEPARATE page** — the report is two pages (main = CopilotKit, sub-page = AG-UI), so open segment 7 with a `[SWITCH to the AG-UI sub-page]` stage cue and a spoken transition that signals the shift ("switching over to AG-UI…") so the viewer knows they've moved to the other page.
8. **AG-UI pain** — where it hurts + the structural constraint (e.g. review bandwidth).
9. **AG-UI Reddit / momentum** — the public win, end the body on an up note.
10. **Close** (~15s) — the week in a sentence, name the 1–2 things the host needs the team to action, point to the linked report. Plain sign-off — no flourish.

**Both pages get airtime — never skip AG-UI.** The routine always produces two pages; even a thin AG-UI week gets segments 7–9 and the `[SWITCH to the AG-UI sub-page]` cue. If AG-UI is genuinely quiet, compress 7–9 into a shorter beat — but cover it and name the page switch. A script that only walks the CopilotKit page is incomplete.

## Pain segment (what the CEO wants)

Lead with this framing in mind: **fixes are one thing; the *pattern* of pain is where to invest.** Per community, answer "where are people actually struggling?" as a theme, not a ticket list:
- Cluster the friction into 1–2 named patterns ("almost all the friction is around one feature — X; people are adopting it faster than we've documented it").
- Call out the one **structural** pain (review bandwidth, single-contributor concentration, docs lagging capability).
- End each community's pain with a one-sentence high-level read the CEO can repeat ("the product's capability is ahead of its polish").
- Source the pain from the report's 💢 Pain + 🔄 Patterns sections — translate, don't transcribe.

## Plain-English translation rules

- **Always say what it means for a user, never the mechanism.** "the chat window crashes when you name your agent" — not "useAgent resolves to the default id." If pushed for depth, the host points to the report.
- Map jargon → plain: *quickstart/CLI* → "the get-started command"; *runtime/HttpAgent* → "running it in the browser"; *adapter* → "the connector for <framework>"; *generative UI / A2UI* → "agents drawing interactive buttons and forms"; *CI* → "an automated check."
- Keep one concrete anchor per issue so it's real ("Siemens," "fourteen thousand stars"), drop the rest.
- Fixed items still get airtime — "we said we'd fix it, it's fixed" is good news worth saying.
- **Don't say "confirmed" (or "verified", "acknowledged") unless a maintainer actually said so in the GitHub issue/PR comments — and you read it.** A support-bot "high-confidence" flag, a clear repro, or cited file paths are NOT a maintainer confirmation. Attribute precisely to what the source shows: "the support bot flagged it as high-confidence," "the reporter cited the exact files," "a maintainer confirmed it in the thread" (only if true). When unsure, describe what was filed, not who agreed. Overstating confirmation is the fastest way to lose credibility on camera.

## Output format

Two columns / two blocks so the host can hide the cues:

- **The spoken script** — what to say, top to bottom, with `[SCROLL to …]` / `[beat]` / `[~m:ss]` cues in brackets the host reads silently. **Bold the one anchor line per segment** so a host who blanks can just read the bold and move on. Top issues appear as a numbered list, one beat each.
- **A cue card** (≤12 lines) — scroll cues + bold anchors only, for off-screen glancing while recording. List the top issues numbered.
- **Pacing notes** — which segment to slow down on (the Pain read), and what to cut for 5 min. No through-line/catchphrase note.

## Hand-off

This is the **last step of the routine** — the report is done; this makes recording painless. Do NOT post the Loom anywhere or add the link yourself — the host records, then the `weekly-report` orchestrator (step 15) adds the `**Loom:**` line to the page + the `🎥 Walkthrough` line to the Slack message once the host shares the URL.

## Cross-references

- `weekly-report` — invokes this skill after publishing; carries the Loom-link insertion rule (step 15)
- `slack-tldr` — the Slack message that gets the `🎥 Walkthrough` line once recorded
