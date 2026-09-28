# @copilotkit/outpost-release-bot

Announces new releases and new YouTube videos in the CopilotKit, AG-UI and
OpenBot Discord channels. A scheduled job: it works out what shipped since its last announcement,
writes each one up, posts, and finishes.

Forwarding release notes verbatim does not work, which is the reason this app
exists rather than a GitHub webhook. CopilotKit's notes are often a single
sentence (`v1.72.0` was 156 characters) and AG-UI's run to thousands of characters
of package tables, well past Discord's 2000-character limit. Neither is something
a reader can skim. So every release is paired with the commits since the previous
release, turned into a few lines about what a developer can now do.

## How it works

One pass over each source, all independent of one another:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. read the channel      what has this bot already announced here?   │
│                          -> the newest announcement is a watermark   │
├──────────────────────────────────────────────────────────────────────┤
│ 2. list the source       GitHub releases / the YouTube feed          │
│                          -> drop drafts, prereleases, other tags     │
│                          -> keep only what shipped after the mark    │
├──────────────────────────────────────────────────────────────────────┤
│ 3. gather context        the commits since the previous release      │
│    (releases only)       on the same tag line                        │
├──────────────────────────────────────────────────────────────────────┤
│ 4. write it up           OpenAI, with the notes and the commit list  │
│    (releases only)       -> a few lines, or SKIP if nothing shipped  │
├──────────────────────────────────────────────────────────────────────┤
│ 5. post                  plain text, source URL last, @everyone off  │
└──────────────────────────────────────────────────────────────────────┘
```

### The files

```
src/
├── sources.ts     what is watched: repo, channel, which tags, how the title reads
├── index.ts       runs one pass over the sources and decides what to post
├── watermark.ts   given a channel's history, which items are still pending
├── github.ts      releases and the commits between them
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
- A failed run needs no recovery, as long as the outage is shorter than the
  lookback window. At 2 items per source per run on a daily schedule the backlog
  drains several times faster than these repos produce releases, so loss starts
  only as an outage approaches the 30-day window.
- A channel with no messages from this bot starts at the newest items rather than
  replaying history.

Two costs. Deleting the bot's messages resets its memory of that channel. And the
search has to reach back far enough. It pages until channel history passes the
lookback window, so the two windows always line up: anything the bot might
announce is something it can check it has not already announced. That gives three
outcomes rather than one:

- something of this source's is found in range, so the newest of those is the
  watermark and the backlog drains forward from it
- nothing of this source's is found at all, so only the newest item is announced
  and the channel is treated as new to it
- something is found but nothing in range, so the oldest message actually read
  becomes the floor and anything older is assumed announced

A channel busy enough to need more than 3000 messages of history to cover 30 days
hits the page ceiling instead. That is logged loudly, because past that point the
bot cannot tell an unannounced release from one it simply could not see.

### Writing the announcement

`summarize.ts` sends the release notes plus the newest 60 commit subjects, and
asks for lines describing what a developer can now do or must now change, with
breaking changes called out first and short headings when a release spans several
areas. Length follows the release: a patch gets two lines, a large release gets
more.

Three behaviours are worth knowing before changing the prompt:

**Raw release notes are never posted.** They are the failure case this step
exists to avoid: the AG-UI release that shipped 1.0 opens with four lines of
"publish the declared MIT license".

**A failure is handled by what it means, not by its status code.** The watermark
is a high-water mark, so announcing a newer release would move it past a failed
one and it would never be retried. Three dispositions:

|         | Example                                                                 | What happens                                                                                      |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Retry   | 429, 5xx, a timeout, or any status this code does not recognise         | The source stops here and holds its position. The next run picks it up                            |
| Give up | A body the provider refuses, a completion truncated at the token budget | Announced with the link and no summary, so it cannot block everything behind it                   |
| Abort   | A rejected model id, a revoked key, or a hard billing limit             | Nothing further is posted. The run stops without trying the remaining sources, and exits non-zero |

The last row is the one that matters most. Treating a missing key as "give up"
filled the channel with "Summary unavailable" posts and moved the watermark past
every one of them, so fixing the key afterwards could not recover a release.

An unrecognised status is a retry for the same reason: it comes from a proxy or
CDN rather than the API, and "give up" is the only outcome that cannot be undone,
so it is the last place to spend on a status nobody has classified.

The line between the last two rows is drawn at "does this repeat for every
release". A hard billing limit does, so it aborts
even though it arrives as a 429, which on its status alone would be a retry. A
truncated completion does not: reasoning spend scales with the input, and one
release with unusually large notes can exhaust the budget while the rest are
fine. Aborting on that stopped the run, silenced every source behind it, and
left the watermark where it was, so the next run stopped in the same place.

**`SKIP` is checked against the commits.** The model can answer `SKIP` when a
release is only dependency bumps, CI or version metadata. It is not consistent
about this, and in testing the same release was summarized on one run and skipped
on the next. So a `SKIP` is only accepted when the compare came back
complete and nothing in it survived the noise filter - dependency bumps, CI,
release chores. Otherwise the model is asked again with `SKIP` ruled out, and if
it answers `SKIP` a second time that answer is taken.

Release notes that say in so many words that nothing shipped skip the release
before the model is asked at all.

"No commits" is four different situations and only two of them corroborate a
skip. Nothing read at all means there was no tiebreaker to consult. Commits read
but all filtered as noise means the release really was version chores, which is
the case `SKIP` exists for. A compare that GitHub answered `identical` also
counts: nothing shipped, definitively, which is the strongest corroboration there
is. The fourth is a compare that was answered but only partly read, because a
page failed. That one reads like the good case while missing most of the release,
so it is excluded: only a complete compare can corroborate.

## Sources

Configured in `src/sources.ts`, one entry per repository. Adding a source is an
entry there plus a channel id in the environment. One other place needs
touching: `main()`'s preflight error message lists the channel variables by name,
so a new one belongs there too, or an operator who sets only it is told nothing
is configured.

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

`include` is an allowlist, so skipping is what happens by default - there is no
predicate per excluded line. The reasons live as a comment above that allowlist
in `src/sources.ts`. This table and that comment say the same thing on purpose:
the comment is for whoever changes the regex, the table for whoever won't open
the file.

## Edge cases

| Situation                             | Behaviour                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Run twice in a row                    | Second run posts nothing                                                                                              |
| Bot switched off for a fortnight      | 2 items per source per run, oldest first, catching up over days                                                       |
| OpenAI key or model is wrong          | Videos still post, then the run stops before any release, exits non-zero                                              |
| OpenAI call fails transiently         | That source stops for the run, nothing posted raw, retried next                                                       |
| Release is only dependency bumps      | Skipped, unless the commits show real work                                                                            |
| Summary longer than Discord allows    | Body trimmed, then the title. The source URL always survives                                                          |
| A channel is not configured           | That source is skipped, the others still run                                                                          |
| A source fails outright               | Logged, the others still run, and the run exits non-zero                                                              |
| No source is configured at all        | The run refuses to start, rather than logging four skips and exiting 0                                                |
| A run exceeds its 20-minute budget    | Sources not yet reached are skipped with a warning, and picked up next run                                            |
| A credential is missing or rejected   | The run stops without trying the rest, and exits non-zero. Videos run first, so they are unaffected by the OpenAI key |
| A source's backlog exceeds the budget | Posts what it reached, defers the rest, logs a warning                                                                |
| Discord rate limit or 5xx             | 429 retried on both; 5xx retried on reads only, never on posts                                                        |
| Release has no previous release       | Announced from its notes alone, with no commit context                                                                |
| Upcoming premiere in the YouTube feed | Ignored until it has actually aired                                                                                   |

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

`dry` skips the POST and nothing else. It still reads the channel, so it needs a
`DISCORD_BOT_TOKEN` with read access, and it still calls OpenAI for each release
it would post, up to the per-run cap, so it still costs money. That is the point of it, since the summary is
usually what you want to check. What it prints is the fully composed message - title, ping prefix, any truncation and the trailing URL - not just the summary.
It does not post, so it cannot exercise the length guard in the posting path.

## Environment

| Variable                     | Required   | Purpose                                                                                                                                                         |
| ---------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`          | yes        | Posting, and reading the channel to see what was already announced                                                                                              |
| `OPENAI_API_KEY`             | per source | Writing the release announcements. Required once any release source has a channel. Videos run first and need it not at all                                      |
| `GITHUB_TOKEN`               | per source | Reading releases and commits. Required once any release source has a channel. Needs no scopes beyond public read; unauthenticated is rate limited to 60 an hour |
| `AGUI_CHANNEL_ID`            | per source | Channel for AG-UI releases                                                                                                                                      |
| `CPK_CHANNEL_ID`             | per source | Channel for CopilotKit releases, and for OpenBot unless given its own                                                                                           |
| `OPENBOT_CHANNEL_ID`         | no         | Gives OpenBot its own channel instead of sharing CopilotKit's. Setting it also turns the ping fallback off                                                      |
| `OPENBOT_PING_ROLE_ID`       | no         | Role to ping for OpenBot. Unset inherits `CPK_PING_ROLE_ID`, unless `OPENBOT_CHANNEL_ID` is set                                                                 |
| `YOUTUBE_CHANNEL_DISCORD_ID` | per source | Channel for video announcements                                                                                                                                 |
| `YOUTUBE_CHANNEL_ID`         | per source | The YouTube channel to watch                                                                                                                                    |
| `AGUI_PING_ROLE_ID`          | no         | Role to ping for AG-UI releases. Unset means silent                                                                                                             |
| `CPK_PING_ROLE_ID`           | no         | Role to ping for CopilotKit releases. Unset means silent                                                                                                        |
| `YOUTUBE_PING_ROLE_ID`       | no         | Role to ping for videos. Unset means silent                                                                                                                     |
| `OPENAI_MODEL`               | no         | Defaults to `gpt-5.4`                                                                                                                                           |

Announcements are silent by default, except that OpenBot inherits CopilotKit's
ping role while it shares CopilotKit's channel. At roughly eight a week across the three
repositories, a ping on every one is how a channel gets muted.

`DISCORD_BOT_TOKEN` is a separate bot identity from
[`apps/discord-bot`](../discord-bot/) and [`apps/discord-mcp`](../discord-mcp/).
This one only posts announcements, so it should not carry the ingest bot's
permissions or the MCP reader's intents.

## Discord permissions

**Send Messages**, **View Channel** and **Read Message History**. Neither of the
last two is optional, and they fail differently. Without **View Channel** the
channel read 403s, the source fails before posting anything, and the run exits
non-zero. Without **Read Message History** nothing fails at all: Discord answers
the read with an empty list rather than an error, so the bot never sees its own
posts, treats the channel as new on every run, and re-announces the newest
release every time. A log line naming a zero-message read is the only sign.

**Embed Links** only affects YouTube announcements. Those post a bare link so
Discord renders the player, which is a better preview than anything the bot could
assemble. Release announcements bracket their URL as `<...>` to suppress the
preview deliberately: the card showed the raw release notes, directly beneath the
summary written to replace them.

## Deployment

A Railway cron service. `railway.toml` carries the build config, the restart
policy, the schedule and the watch patterns, so a recreated service is still
scheduled rather than running once at deploy and never again, and an unrelated
push elsewhere in the monorepo does not trigger an extra run.

`restartPolicyType` is `NEVER`, unlike the long-running services in this repo. A
completed run exits, and an `ALWAYS` policy would read that as a crash and restart
it in a loop.

The image is built from `apps/release-bot/Dockerfile` and pins `node:22.20-alpine`.
That floor matters: corepack in Node 22.12 and 22.13 predates npm's registry key
rotation and cannot activate pnpm, so the build fails outright. 22.14 is the
first version that works, which is also what `engines.node` declares.

The container runs `node dist/index.js` directly and does not read a `.env` file,
unlike `pnpm start` locally. Every variable has to be set in Railway.
