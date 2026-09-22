# @copilotkit/outpost-release-bot

Announces new releases and new YouTube videos in the CopilotKit, AG-UI and
OpenBot Discord channels. A scheduled job: it works out what shipped since its last announcement,
writes each one up, posts, and finishes.

Forwarding release notes verbatim does not work, which is the reason this app
exists rather than a GitHub webhook. CopilotKit's notes are often a single
sentence (`v1.72.0` was 156 characters) and AG-UI's run to thousands of characters
of package tables, well past Discord's 2000-character limit. Neither is something
a reader can skim. So every release is paired with the commits since the previous
release, rewritten into a few lines about what a developer can now do, and
credited to whoever outside the team worked on it.

## How it works

One pass over three sources, each independent of the others:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. read the channel      what has this bot already announced here?   │
│                          -> the newest announcement is a watermark   │
├──────────────────────────────────────────────────────────────────────┤
│ 2. list the source       GitHub releases / the YouTube feed          │
│                          -> drop drafts, prereleases, other tags     │
│                          -> keep only what shipped after the mark    │
├──────────────────────────────────────────────────────────────────────┤
│ 3. gather context        commits since the previous release, and     │
│    (releases only)       their authors                               │
├──────────────────────────────────────────────────────────────────────┤
│ 4. write it up           OpenAI, with the notes and the commit list  │
│    (releases only)       -> a few lines, or SKIP if nothing shipped  │
├──────────────────────────────────────────────────────────────────────┤
│ 5. post                  plain text, source URL last, mentions off   │
└──────────────────────────────────────────────────────────────────────┘
```

### The files

```
src/
├── sources.ts     what is watched: repo, channel, which tags, how the title reads
├── index.ts       runs one pass over the sources and decides what to post
├── watermark.ts   given a channel's history, which items are still pending
├── github.ts      releases, the commits between them, and who is on the team
├── youtube.ts     the channel's RSS feed
├── summarize.ts   turns a release into a few lines, or says to skip it
├── discord.ts     reads the channel, builds the message, posts it
└── http.ts        timeouts and JSON parsing shared by the above
```

`sources.ts` is the file to edit for anything about coverage. `index.ts` never
names a repository.

There is no database, no queue and no shared package. It is HTTPS calls and the
decisions between them.

### Knowing what has already been announced

The channel is the record. Every announcement ends with its source URL, so the
bot reads back its own recent messages, collects those URLs, and treats the newest
as a watermark. Only items published after the watermark are announced, oldest
first, so the watermark advances one step at a time.

Two details carry most of the correctness:

**Announce forward, never backwards.** "Newer than the last announcement" is not
the same as "anything the channel does not mention". The second walks backwards
through history and announces releases that predate the bot entirely.

**Drain oldest first.** Taking the newest pending items instead moves the
watermark straight to the top, and everything between is dropped permanently
rather than caught up later. That selection lives in `watermark.ts`, apart from
the entry point so it can be tested without starting a run, and it is covered by
tests for exactly that reason.

**Count posts, not candidates.** A skipped release leaves no trace in the
channel, so when skips consumed the per-run budget two skippable releases in a
row stalled a source until they aged out of the window. The cap is on
announcements made; a separate cap bounds how many releases are examined.

What follows from using the channel as the record:

- Running twice in a row posts nothing the second time.
- A crash halfway through a batch cannot cause a repeat, because what was posted
  is visibly in the channel and what was not is still absent.
- A failed run needs no recovery. The next run picks up what was missed.
- A channel with no messages from this bot starts at the newest items rather than
  replaying history.

Two costs. Deleting the bot's messages resets its memory of that channel. And the
search is bounded at 300 messages: past that, the oldest message actually read
becomes the floor, so anything published before it is assumed announced rather
than posted again.

### Writing the announcement

`summarize.ts` sends the release notes plus the newest 60 commit subjects, and
asks for lines describing what a developer can now do or must now change, with
breaking changes called out first and short headings when a release spans several
areas. Length follows the release: a patch gets two lines, a large release gets
more.

Three behaviours are worth knowing before changing the prompt:

**Nothing is ever posted unsummarized.** If the OpenAI call fails, the source
stops there for this run rather than falling back to the raw notes. The raw notes
are the failure case this step exists to avoid: the AG-UI release that shipped 1.0
opens with four lines of "publish the declared MIT license".

**A transient failure stops the source; a permanent one does not.** The watermark
is a high-water mark, so announcing a newer release would move it past a failed
one and it would never be retried. But a release that can never be summarized
(a rejected model id, a body the provider refuses) would then block everything
behind it, so those are announced with the link and no summary instead.

**`SKIP` is checked against the commits.** The model can answer `SKIP` when a
release is only dependency bumps, CI or version metadata. It is not consistent
about this, and in testing the same release was summarized on one run and skipped
on the next. So a `SKIP` is only accepted when no commit subject looks like a
feature, fix or perf change, docs scopes excluded; otherwise the model is asked
again with `SKIP` ruled out.

### Crediting contributors

Authors come from the commits between the two releases, with bots and noise
commits filtered out, and contributors outside the org are thanked by name, up to
six with the rest counted.

Team membership is read from the GitHub orgs rather than a list in the code, which
means `GITHUB_TOKEN` needs `read:org`. A token without it does not fail: it
returns HTTP 200 and an empty member list. So the lookup is all or nothing across
both orgs, and an empty org counts as unresolved. If any page of any org cannot
be read, no credit line is added at all, because publicly thanking colleagues as
though they were outside contributors is worse than saying nothing. `CORE_LOGINS`
extends the team list but cannot assert that the lookup worked.

GitHub logins cannot be resolved to Discord accounts, so credit is plain text.
Tagging would mean either guessing or pinging people who never joined the server.

## Sources

Configured in `src/sources.ts`, one entry per repository. Adding a source is an
entry there plus a channel id in the environment; nothing else needs touching.

| Source                  | Announced                                       |
| ----------------------- | ----------------------------------------------- |
| `ag-ui-protocol/ag-ui`  | `release/YYYY-MM-DD` tags                       |
| `CopilotKit/CopilotKit` | `vX.Y.Z`, `channels/vX.Y.Z`, `angular/vX.Y.Z`   |
| `CopilotKit/OpenBot`    | `vX.Y.Z`                                        |
| CopilotKit on YouTube   | Every published video, as a bare link to unfurl |

Channel ids live in the environment because they differ per server and per
deployment. Tag filters and titles live in the source file because they are
decisions about what is worth announcing and how it should read, and each has its
reason written next to it.

Sources can share a channel: CopilotKit and OpenBot both post to the CopilotKit
community's releases channel by default, which is why every announcement names
its product on the first line rather than leaving the channel to imply it.

```
CopilotKit 1.73.0        Channels SDK 0.10.0
OpenBot 0.0.15           AG-UI 2026-09-17
```

Give OpenBot `OPENBOT_CHANNEL_ID` if it should have a channel of its own. Note
that two sources in one channel can each post up to the per-run cap.

AG-UI aggregates a day's package publishes into one dated release, so the tag
shape is all the filter needs to be.

CopilotKit publishes several release lines from one repo. Announced are the ones
that are both a product people install and still shipping: the main line, the
Channels SDK and the Angular SDK. Patches count, since a two-line release that
fixes something people are hitting is worth saying.

The rest are skipped, with their share of the last 100 releases:

| Line                                                                                        | Why                                                                                                   |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `channels-teams/`, `-slack/`, `-whatsapp/`, `-telegram/`, `-discord/`, `-intelligence/` (8) | Per-adapter packages, all last released 2026-07-10 and superseded by the `channels/` umbrella         |
| `bot/`, `bot-slack/`, `bot-teams/` (6)                                                      | Last released 2026-06-25; OpenBot now lives in its own repo                                           |
| `intelligence-mastra/`, `intelligence-langgraph/` (4)                                       | Version alignment. `intelligence-mastra/v1.71.2`'s notes say the API and implementation are unchanged |
| `python-sdk/` (3)                                                                           | Still shipping, but the release notes are only a PyPI link                                            |
| `pr-*`, `vundefined`, `PR` (5+)                                                             | Preview and junk tags that exist in the repo                                                          |

The distinction that matters: a `channels/` release is the SDK shipping, while
`channels-teams/` is one adapter's version moving.

Each of those is one `include` predicate in `src/sources.ts`, with the reason
written above it. The README table and that comment say the same thing on
purpose: the comment is for whoever changes the regex, the table for whoever
won't open the file.

## Edge cases

| Situation                             | Behaviour                                                       |
| ------------------------------------- | --------------------------------------------------------------- |
| Run twice in a row                    | Second run posts nothing                                        |
| Bot switched off for a fortnight      | 2 items per source per run, oldest first, catching up over days |
| OpenAI call fails                     | That source stops for the run, nothing posted raw, retried next |
| `GITHUB_TOKEN` cannot see the org     | Announced with no credit line, never crediting the team         |
| Release is only dependency bumps      | Skipped, unless the commits show real work                      |
| Summary longer than Discord allows    | Body trimmed; the title and source URL always survive           |
| A channel is not configured           | That source is skipped, the others still run                    |
| A source fails outright               | Logged, the others still run, and the run exits non-zero        |
| Discord rate limit or 5xx             | Up to 3 attempts honouring `retry-after`, reads included        |
| Release has no previous release       | Announced from its notes alone, with no commit context          |
| Upcoming premiere in the YouTube feed | Ignored until it has actually aired                             |

## Setup

```bash
# 1. Install + build
pnpm install
pnpm --filter @copilotkit/outpost-release-bot build

# 2. Configure (gitignored)
cp apps/release-bot/.env.example apps/release-bot/.env

# 3. See what it would post, without posting
pnpm --filter @copilotkit/outpost-release-bot dry
```

`dry` skips the POST and nothing else: it still reads the channel, so it needs a
`DISCORD_BOT_TOKEN` with read access, and it still calls OpenAI for every pending
release, so it still costs money. That is the point of it, since the summary is
usually what you want to check.

## Environment

| Variable                     | Required   | Purpose                                                                                                    |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`          | yes        | Posting, and reading the channel to see what was already announced                                         |
| `OPENAI_API_KEY`             | yes        | Writing the announcements. Without it nothing is announced                                                 |
| `GITHUB_TOKEN`               | yes        | Needs `read:org`, to tell the team from outside contributors. Missing, the run fails rather than degrading |
| `AGUI_CHANNEL_ID`            | per source | Channel for AG-UI releases                                                                                 |
| `CPK_CHANNEL_ID`             | per source | Channel for CopilotKit releases                                                                            |
| `YOUTUBE_CHANNEL_DISCORD_ID` | per source | Channel for video announcements                                                                            |
| `YOUTUBE_CHANNEL_ID`         | per source | The YouTube channel to watch                                                                               |
| `AGUI_PING_ROLE_ID`          | no         | Role to ping for AG-UI releases. Unset means silent                                                        |
| `CPK_PING_ROLE_ID`           | no         | Role to ping for CopilotKit releases. Unset means silent                                                   |
| `YOUTUBE_PING_ROLE_ID`       | no         | Role to ping for videos. Unset means silent                                                                |
| `CORE_LOGINS`                | no         | Comma-separated logins treated as team, on top of org membership                                           |
| `OPENAI_MODEL`               | no         | Defaults to `gpt-5.4`                                                                                      |

Announcements are silent by default. At roughly eight a week across the three
repositories, a ping on every one is how a channel gets muted.

`DISCORD_BOT_TOKEN` is a separate bot identity from
[`apps/discord-bot`](../discord-bot/) and [`apps/discord-mcp`](../discord-mcp/).
This one only posts announcements, so it should not carry the ingest bot's
permissions or the MCP reader's intents.

## Discord permissions

**Send Messages**, **View Channel** and **Read Message History**. The last two are
not optional: reading the channel is how the bot knows what it has already
announced, and without them the run fails before posting anything.

**Embed Links** is not needed to post, since announcements are plain text, but
without it Discord will not unfurl the trailing link into a preview. The bot
never reads those preview embeds back: it unfurls every link in a message,
including any the model wrote into the summary, which is not a safe identity.

## Deployment

A Railway cron service. `railway.toml` carries the build config, the restart
policy, the schedule and the watch patterns, so a recreated service is still
scheduled rather than running once at deploy and never again, and an unrelated
push elsewhere in the monorepo does not trigger an extra run.

`restartPolicyType` is `NEVER`, unlike the long-running services in this repo. A
completed run exits, and an `ALWAYS` policy would read that as a crash and restart
it in a loop.
