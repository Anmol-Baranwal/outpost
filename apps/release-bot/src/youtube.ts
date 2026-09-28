/**
 * YouTube source.
 *
 * Every channel publishes a public RSS feed, so this needs no API key and no
 * quota. The feed carries the latest 15 videos, which is plenty for a job that
 * runs on a schedule.
 */

import { MAX_ATTEMPTS, TIMEOUT_MS, backoff, pause, retryAfterMs } from './http.js';

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

export type Video = {
    id: string;
    url: string;
    publishedAt: string;
};

export async function listVideos(channelId: string, since: string): Promise<Video[]> {
    const xml = await readFeed(channelId);
    const videos = parseFeed(xml);

    if (!videos.length) {
        // The feed is XML scraped with regexes, so an empty result is as likely
        // to be a feed-shape change as a genuinely empty channel. The two are
        // distinguishable: a body that carries `<entry` and still parses to
        // nothing is a broken parser, not an empty channel. Warning about that
        // let the run exit 0 and the cron report success while video
        // announcements were dead, so it throws and joins main()'s failure list.
        if (xml.includes('<entry')) {
            throw new Error(
                `${channelId}: the YouTube feed carries entries but parseFeed read none of them. ` +
                    'Video announcements are stopped until parseFeed is updated to the feed format.',
            );
        }
        console.warn(`${channelId}: no entries parsed from the YouTube feed`);
    }

    const start = Date.parse(since);
    const now = Date.now();

    return videos
        .filter((v) => {
            if (Number.isNaN(Date.parse(v.publishedAt))) {
                // The <entry>-present guard above runs before this filter, so a
                // date-format change parses entries fine, then NaN-compares
                // every one of them to false and drops the lot with no output -
                // the silent-death case that guard exists to prevent, arriving
                // one step later.
                throw new Error(
                    `${channelId}: unparseable <published> "${v.publishedAt}" on ${v.id}. ` +
                        'The feed format changed; parseFeed needs updating.',
                );
            }
            const at = Date.parse(v.publishedAt);
            // Scheduled premieres and upcoming live streams appear in the feed
            // before they air, and announcing those is announcing nothing.
            return at > start && at <= now;
        })
        .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
}

/**
 * The feed body, with bounded retries.
 *
 * Retried for the same reason the GitHub and Discord reads are, and with the
 * same shape: this is a plain idempotent GET, so a transient 502 or a socket
 * reset costs nothing to repeat, while failing it took the YouTube source down
 * and pushed the whole run's exit code to 1. A 4xx other than a rate limit is
 * not retried: a deleted or mistyped channel id answers the same way every time.
 */
async function readFeed(channelId: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
        const last = attempt >= MAX_ATTEMPTS;

        let res: Response;
        try {
            res = await fetch(`${FEED}${channelId}`, {
                headers: { 'User-Agent': 'copilotkit-release-bot' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            if (last) throw error;
            await pause(backoff(attempt));
            continue;
        }

        if (res.ok) return res.text();

        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && !last) {
            await pause(retryAfterMs(res) ?? backoff(attempt));
            continue;
        }

        // Read the body even though only the status is interesting: under undici
        // an unread body holds its connection out of the pool until garbage
        // collection, and this is the one path that neither returns res.text()
        // nor passes through retryAfterMs().
        throw new Error(
            `YouTube feed ${res.status} for channel ${channelId}: ${(await res.text()).slice(0, 200)}`,
        );
    }
}

/** Exported for tests: the feed format is the part most likely to drift. */
export function parseFeed(xml: string): Video[] {
    // `<entry` rather than `<entry>`, so an added namespace attribute does not
    // silently yield zero videos.
    return xml
        .split(/<entry[\s>]/)
        .slice(1)
        .map((entry) => {
            const id = tag(entry, 'yt:videoId');
            return {
                id,
                url: `https://www.youtube.com/watch?v=${id}`,
                publishedAt: tag(entry, 'published'),
            };
        })
        .filter((v) => v.id && v.publishedAt);
}

function tag(xml: string, name: string): string {
    const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
    return match ? match[1].trim() : '';
}
