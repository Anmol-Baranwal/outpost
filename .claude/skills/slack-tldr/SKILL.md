---
name: slack-tldr
description: Build the locked Slack TL;DR JSON payload from a completed weekly report. Saves to /tmp/slack-msg.json with the exact curl command for Nathan to post manually. Triggers on "draft Slack TL;DR", "Slack post", "build the Slack message".
---

# Slack TL;DR

Build a Slack-ready JSON payload from a completed weekly report.

## Locked format

The Slack app posting this is named `CopilotKit Community Signal` — its name renders as the header. The message body STILL opens with a bold `*Weekly Community Signal* 📣` title line (it reads cleaner and survives if the app name changes).

**Top issues are nested per community** — a parent bullet per community, each top issue an indented sub-bullet. Sub-bullets use `◦` with 4 leading spaces (incoming webhooks can't do true Block-Kit nested lists, but this matches the look). Keep each top-issue label to ~2–4 words.

```
*Weekly Community Signal* 📣

*TL;DR —* <one-line summary in plain English>

📊 *Week of <Mon DD>-<DD>*
• 🔝 *Top issues — CopilotKit:*
    ◦ <issue 1 short label>
    ◦ <issue 2 short label>
    ◦ …
• 🔝 *Top issues — AG-UI:*
    ◦ <issue 1 short label>
    ◦ …
• Community issues raised: *<N>* (<gh-count> GitHub · <discord-count> Discord)
• Resolved: *<N>* ✅ (<short list of what got fixed>)
• Top pain: *<short name>* — <N> reporters
• Open fix PRs: *<N>* awaiting review
• 🟠 Reddit Pulse (90-day): CopilotKit *<NN>/100* · AG-UI *<NN>/100* — <one-phrase vibe>

🎥 Loom → <<loom-url>|Walkthrough>
Full report → <<notion-url>|<Mon DD>-<DD>>
```

This nested layout replaced the older flat single-line Top-issues bullet + the **Top demand** and **🏢 Enterprise reporters** lines (dropped — they cluttered the scan; the full report carries them). Re-add a dropped line only if a week genuinely needs it.

## Rules

- **Title line** `*Weekly Community Signal* 📣` is the first line, then a blank line, then the TL;DR.
- **Plain-English TL;DR line** leads — written for a non-engineer reader (marketing, leadership). One sentence: the headline takeaway. Don't pack metrics — bullets handle that. (The dash style is `*TL;DR —* <text>`, not `*TL;DR — <text>*`.)
- **Center it on leadership** — the business-relevant read: production/user impact, fix status ("fix in review"), and enterprise/GTM signal (who's building on us). Not implementation detail. A leader should be able to skim this one line and know what matters this week.
- **No hype — plain and factual.** State what happened; let the reader judge its size. Ban dramatization: no "loud on signal," "broke the front door," "the week's worst bugs," "showed up in force," "silently" as a scare word, etc. Same neutral register as the Loom briefing — describe the items plainly (e.g. "Light week for volume. Worth knowing: a cross-origin auth bug blocks the default useAgent connection; a few bugs fail without surfacing an error; engineers from Microsoft, SAP, AWS, and Nvidia filed issues."). If a phrase sounds like marketing copy, rewrite it flat.
- **Top issues are nested per community** — `• 🔝 *Top issues — CopilotKit:*` then each top issue as a `    ◦` sub-bullet, then the same for AG-UI. Short labels (~2–4 words), mirroring that page's Top-issue cards. This replaced the flat one-line version.
- **Issues raised** = total combining GitHub + Discord. Don't separate Discord by channel.
- **Resolved** = items in `### ✅ Resolved this week`, with a parenthetical short list.
- **Top pain** = largest pain cluster's short name + distinct-reporter count.
- **Open fix PRs** = aggregate count from Fix PR detection.
- **Reddit Pulse** = the two per-community 0–100 Pulse Scores (CopilotKit + AG-UI, rolling 90-day) + a one-phrase combined vibe, from the report's 🟠 Reddit Pulse sections. **Skip the line** if the `composio` Reddit source was unconfigured ("source not configured"). Show only one side's score if the other had no posts.
- **Dropped lines:** **Top demand** and **🏢 Enterprise reporters** are no longer in the Slack TL;DR (they live in the full report). Don't add them back unless a week's signal really calls for it.
- **Loom + Full report** are the last two lines (Loom above), both Slack `<url|label>` links. The Loom line is added once Nathan shares the recording (see `weekly-report` step 15); until then leave the `<LOOM_URL|Walkthrough>` placeholder.
- **Full report link** uses Slack's `<url|label>` syntax with the label `<Mon DD>-<DD>` matching the Notion title.
- **Emoji limited:** 📣 on the title, 📊 leads the week line, 🔝 marks each Top-issues parent bullet, ✅ marks Resolved, 🟠 marks Reddit Pulse, 🎥 marks Loom. No other emoji.

## Payload file

Save to `/tmp/slack-msg.json`:

```json
{
  "text": "<the formatted message>"
}
```

Use `\n` for line breaks inside the JSON string. Escape `*` as needed if it appears in content.

## Curl command

After saving, output the exact curl Nathan runs:

```bash
curl -X POST -H "Content-Type: application/json" --data @/tmp/slack-msg.json "$SLACK_WEBHOOK_URL"
```

Webhook URL lives in Nathan's env. Don't include the URL inline; tell him to `export SLACK_WEBHOOK_URL=...` from the Slack app config first.

## Dual-community handling

Top issues are **always split per community** (the two `🔝 Top issues — …` parent bullets). The remaining metric bullets (Issues raised, Resolved, Top pain, Open fix PRs) are **combined** across both communities — pick the loudest for single-value lines like Top pain. Reddit Pulse shows both scores side by side. This keeps the message scannable while still surfacing each community's headline issues.

## Post-publish workflow

Slack post is primarily for product + engineering. Marketing gets a separate cut on request — see CLAUDE.md commit history for the "marketing cut" template.

Don't post automatically. Always show the JSON to Nathan first, let him review and curl manually. Outpost will own auto-post when it lands.

## Cross-references

- `weekly-report` — the orchestrator invokes this skill at step 13
- The Notion page URL comes from the create-pages return value
