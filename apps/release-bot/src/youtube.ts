/**
 * YouTube source.
 *
 * Every channel publishes a public RSS feed, so this needs no API key and no
 * quota. The feed carries the latest 15 videos, which is plenty for a job that
 * runs on a schedule.
 */

import { TIMEOUT_MS } from './http.js';

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

export type Video = {
    id: string;
    url: string;
    publishedAt: string;
};

export async function listVideos(channelId: string, since: string): Promise<Video[]> {
    const res = await fetch(`${FEED}${channelId}`, {
        headers: { 'User-Agent': 'copilotkit-release-bot' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`YouTube feed ${res.status} for channel ${channelId}`);

    const xml = await res.text();
    const videos = parseFeed(xml);

    if (!videos.length) {
        // The feed is XML scraped with regexes, so an empty result is as likely
        // to be a feed-shape change as a genuinely empty channel. Returning []
        // silently would take the YouTube source quiet with no signal.
        console.warn(`${channelId}: no entries parsed from the YouTube feed`);
    }

    const start = Date.parse(since);
    const now = Date.now();

    return videos
        .filter((v) => {
            const at = Date.parse(v.publishedAt);
            // Scheduled premieres and upcoming live streams appear in the feed
            // before they air, and announcing those is announcing nothing.
            return at > start && at <= now;
        })
        .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
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
