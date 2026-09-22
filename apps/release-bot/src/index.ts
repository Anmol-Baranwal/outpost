/**
 * One pass: look at what each channel already says, find what shipped since,
 * announce the difference.
 *
 * The channel is the source of truth. Every announcement ends with its source
 * URL, so "have we said this already" is answered by reading the bot's own
 * recent messages rather than by trusting a file to still be accurate.
 *
 * Run it on any schedule. Running it twice in a row posts nothing the second
 * time, and a crash halfway through a batch cannot cause a repeat.
 */

import { pathToFileURL } from 'node:url';
import { listReleases, contextFor, type Release } from './github.js';
import { listVideos, type Video } from './youtube.js';
import { summarize } from './summarize.js';
import { announce, announced, postText, withPing } from './discord.js';
import { pending } from './watermark.js';
import { SOURCES, type Source } from './sources.js';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * How far back to look for things to announce.
 *
 * This also bounds the watermark: if the last announced item is older than the
 * window, the run cannot see it and falls back to announcing the newest items.
 */
const LOOKBACK_DAYS = 30;

/**
 * Most announcements *posted* per source per run. A source that has been off for
 * a fortnight catches up over several runs instead of emptying its backlog into
 * the channel at once. Two sources pointed at one channel can each post this
 * many.
 *
 * Counted on posts, not on candidates: a skipped release leaves no trace in the
 * channel, so when skips consumed the budget two skippable releases in a row
 * stalled a source until they aged out of the window.
 */
const MAX_PER_RUN = 2;

/**
 * Most releases examined per source per run, however few of them post. Bounds
 * the OpenAI spend on a long run of skippable releases.
 */
const MAX_CONSIDERED = 10;

function lookback(): string {
    return new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
}

/** Contributors outside the org, named in the announcement. */
function credit(contributors: { login: string; external: boolean }[]) {
    const external = contributors.filter((c) => c.external);
    if (!external.length) return undefined;

    const shown = external.slice(0, 6).map((c) => c.login);
    const rest = external.length - shown.length;
    const others = rest === 1 ? 'other' : 'others';
    const names = rest > 0 ? `${shown.join(', ')} and ${rest} ${others}` : shown.join(', ');
    return `thanks ${names} for contributing :)`;
}

async function announceReleases(source: Source) {
    if (!source.channelId) {
        console.log(`${source.name}: no channel configured, skipping`);
        return;
    }

    const seen = await announced(source.channelId);
    const releases = (await listReleases(source.repo, lookback())).filter((r) =>
        source.include(r.tag),
    );

    let posted = 0;

    for (const release of pending<Release>(releases, seen).slice(0, MAX_CONSIDERED)) {
        if (posted >= MAX_PER_RUN) break;

        // The previous release of the same line, from this list: tag adjacency
        // could pick a baseline from an unrelated tag line.
        const previous = releases[releases.indexOf(release) - 1];
        const context = await contextFor(release, previous);
        const summary = await summarize(context);

        if (summary.kind === 'failed' && summary.retryable) {
            // Stop this source here, holding its position. Announcing a newer
            // release would move the watermark past this one and it would never
            // be retried, even though asking again would have worked.
            throw new Error(`${release.tag}: ${summary.reason}`);
        }

        if (summary.kind === 'skip') {
            console.log(`${release.tag}: nothing user-facing, skipped`);
            continue;
        }

        // A permanent failure still gets announced, with the link instead of a
        // summary. Raw notes are never posted, but silence is not the answer
        // either: a release that can never be summarized would otherwise block
        // every release behind it for as long as it stays in the window.
        const body =
            summary.kind === 'text' ? summary.text : 'Summary unavailable. See the release notes.';

        if (summary.kind === 'failed') {
            console.error(`${release.tag}: ${summary.reason}; announcing with the link only`);
        }

        const announcement = {
            channelId: source.channelId,
            title: source.title(release),
            body,
            footer: credit(context.contributors),
            url: release.url,
            pingRoleId: source.pingRoleId,
        };

        if (DRY_RUN) {
            console.log(`\n--- ${source.name} ${release.tag} ---\n${body}`);
            if (announcement.footer) console.log(announcement.footer);
            posted++;
            continue;
        }

        await announce(announcement);
        posted++;
        console.log(`${source.name} ${release.tag}: posted`);
    }
}

/**
 * Videos post as a line of text and a bare link. Discord unfurls the link into a
 * player, which is a better preview than anything we could assemble, so the
 * message stays out of its way.
 */
async function announceVideos() {
    const channelId = process.env.YOUTUBE_CHANNEL_DISCORD_ID;
    const youtubeChannel = process.env.YOUTUBE_CHANNEL_ID;

    if (!channelId || !youtubeChannel) {
        console.log('youtube: no channel configured, skipping');
        return;
    }

    const seen = await announced(channelId);
    const videos = await listVideos(youtubeChannel, lookback());
    const pingRoleId = process.env.YOUTUBE_PING_ROLE_ID;

    for (const video of pending<Video>(videos, seen).slice(0, MAX_PER_RUN)) {
        const content = withPing(`New video on the YouTube channel\n${video.url}`, pingRoleId);

        if (DRY_RUN) {
            console.log(`\n--- youtube ---\n${content}`);
            continue;
        }

        await postText(channelId, `New video on the YouTube channel\n${video.url}`, pingRoleId);
        console.log(`youtube ${video.id}: posted`);
    }
}

/**
 * Each source runs independently, so a broken channel or a rate-limited API
 * cannot take the others down with it. A run that lost any source exits
 * non-zero, because a cron job reporting success while announcing nothing is the
 * one failure nobody notices.
 */
async function main() {
    const failures: string[] = [];

    const run = async (name: string, work: () => Promise<void>) => {
        try {
            await work();
        } catch (error) {
            failures.push(name);
            console.error(`${name} failed:`, error);
        }
    };

    for (const source of SOURCES) {
        await run(source.name, () => announceReleases(source));
    }
    await run('youtube', announceVideos);

    if (failures.length) {
        throw new Error(`Sources failed: ${failures.join(', ')}. The others completed.`);
    }
}

// Only when run as the entry point. `pending()` used to live here, and importing
// it from a test started a real announcement run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
