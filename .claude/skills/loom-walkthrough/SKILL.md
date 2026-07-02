---
name: loom-walkthrough
description: Generate the 5-7 minute Loom walkthrough script for a completed Weekly Community Signal report — radio-show style, plain English, sounds ad-libbed not read. Runs after every report (invoked by weekly-report) and on "loom script", "walkthrough script", "record the loom", "narrate the report".
---

# Loom walkthrough script

Turn a finished Weekly Community Signal report into a spoken walkthrough the host can record with confidence — **without sounding like they're reading a script.** The host doesn't know the engineering deeply, so every line must be in plain "what it means for us" English, never internals.

This runs **after every report** — the `weekly-report` orchestrator invokes it once both pages are published, and it's independently triggerable ("loom script", "record the loom").

## The #1 rule: it must not sound scripted

The host reads this on camera. If it sounds read, the whole thing falls flat. So:

- **No on-camera meta.** Never write words the host would say that reveal a script or structure: no "in this report," "next section," "the top issues are," "moving on," "as you can see." Just talk.
- **Vary the cold open every week.** Never reuse last week's opener. Rotate the *kind* of open — a number that surprised you, a one-line mood, a "good news first," a callback to last week, a single headline. Pick whatever fits this week's actual signal.
- **Write in the host's cadence, not a memo's.** Contractions. Short sentences. The occasional aside ("honestly," "here's the part I'd flag," "quiet week, not a bad one"). One human reaction per segment.
- **One fresh through-line per week, not a fixed catchphrase.** Find the week's actual pattern (e.g. "demand is outrunning polish") and land it twice — once in the middle, once at the close. Different phrase every week; don't make it a recurring slogan.
- **Numbers spoken, not written.** "about two months," "fifty out of a hundred," "two companies to six" — never "~2mo" or "50/100" in the spoken lines.
- **Stage directions live in a hidden sidebar** (`[SCROLL to …]`, `[beat]`, time markers) — clearly separated so the host reads them silently and never speaks them. They are cues, not lines.

## Length

**5–7 minutes** (~800–1100 spoken words). Mark rough time stamps so the host can pace. Always include a "to hit 5 minutes, cut these" note listing the 2–3 most trimmable lines.

## Segment flow (adapt to the week — don't force empty ones)

1. **Cold open** (~20s) — hook, fresh each week. No meta.
2. **The week in one breath** — the single takeaway + the pattern to watch. This is the TL;DR spoken aloud.
3. **CopilotKit — top issues** — each top issue in 1–2 plain sentences: what it means for a user + status (fixed / open / approved). Never how it broke internally.
4. **Pain — the high-level read (the CEO segment — slow down here).** NOT issue-by-issue. Name *where people are struggling* as a pattern, per community, plus the one structural pain. The CEO wants the shape of the hurt, not a bug list. (See "Pain segment" below.)
5. **Enterprise** — count + trend + the one-line "how they showed up / what to do."
6. **CopilotKit Reddit** — score + one-phrase vibe (trimmable).
7. **AG-UI — top issues** — same plain treatment; flag the one that matters most. **This is a SEPARATE page** — the report is two pages (main = CopilotKit, sub-page = AG-UI), so open segment 7 with a `[SWITCH to the AG-UI sub-page]` stage cue and a spoken transition that signals the shift ("switching over to AG-UI…") so the viewer knows they've moved to the other page.
8. **AG-UI pain** — where it hurts + the structural constraint (e.g. review bandwidth).
9. **AG-UI Reddit / momentum** — the public win, end the body on an up note.
10. **Close** (~20s) — the week in a sentence, restate the through-line, name the 1–2 asks, point to the linked report. Warm sign-off.

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

- **The spoken script** — what to say, top to bottom, with `[SCROLL to …]` / `[beat]` / `[~m:ss]` cues in brackets the host reads silently. **Bold the one anchor line per segment** so a host who blanks can just read the bold and move on.
- **A cue card** (≤12 lines) — scroll cues + bold anchors only, for off-screen glancing while recording.
- **Pacing notes** — which segment is the CEO's (slow down), what to cut for 5 min, and the week's through-line phrase to land twice.

## Hand-off

This is the **last step of the routine** — the report is done; this makes recording painless. Do NOT post the Loom anywhere or add the link yourself — the host records, then the `weekly-report` orchestrator (step 15) adds the `**Loom:**` line to the page + the `🎥 Walkthrough` line to the Slack message once the host shares the URL.

## Cross-references

- `weekly-report` — invokes this skill after publishing; carries the Loom-link insertion rule (step 15)
- `slack-tldr` — the Slack message that gets the `🎥 Walkthrough` line once recorded
