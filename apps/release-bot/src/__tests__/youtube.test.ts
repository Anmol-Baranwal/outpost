import { afterEach, describe, expect, it, vi } from 'vitest';
import { listVideos, parseFeed } from '../youtube.js';

const entry = (id: string, published: string, attrs = '') => `
  <entry${attrs}>
    <yt:videoId>${id}</yt:videoId>
    <title>A video</title>
    <published>${published}</published>
  </entry>`;

describe('parseFeed', () => {
    it('reads video ids and timestamps', () => {
        const videos = parseFeed(
            `<feed>${entry('abc123', '2026-09-11T19:33:39+00:00')}${entry('def456', '2026-09-10T16:23:21+00:00')}</feed>`,
        );

        expect(videos).toEqual([
            {
                id: 'abc123',
                url: 'https://www.youtube.com/watch?v=abc123',
                publishedAt: '2026-09-11T19:33:39+00:00',
            },
            {
                id: 'def456',
                url: 'https://www.youtube.com/watch?v=def456',
                publishedAt: '2026-09-10T16:23:21+00:00',
            },
        ]);
    });

    it('still parses entries that carry attributes', () => {
        // Splitting on the literal `<entry>` returned nothing the moment the
        // feed added a namespace, which read as an empty channel.
        const videos = parseFeed(
            `<feed>${entry('abc123', '2026-09-11T19:33:39+00:00', ' xml:lang="en"')}</feed>`,
        );
        expect(videos.map((v) => v.id)).toEqual(['abc123']);
    });

    it('drops entries with no id or timestamp', () => {
        expect(parseFeed('<feed><entry><title>broken</title></entry></feed>')).toEqual([]);
    });

    it('returns nothing for an empty feed', () => {
        expect(parseFeed('<feed></feed>')).toEqual([]);
    });
});

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
    vi.stubGlobal('fetch', ORIGINAL_FETCH);
    vi.useRealTimers();
});

const feed = (body: string) => new Response(body, { status: 200 });

describe('listVideos', () => {
    const SINCE = '2026-09-01T00:00:00.000Z';

    it('fails when the feed carries entries but none of them parse', async () => {
        // A feed-shape change parses as zero videos, and warning about it let
        // the run exit 0 while video announcements were dead.
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => feed('<feed><entry><title>broken</title></entry></feed>')),
        );

        await expect(listVideos('chan', SINCE)).rejects.toThrow(/parseFeed/);
        await expect(listVideos('chan', SINCE)).rejects.toThrow(/announcements are stopped/);
    });

    it('only warns when the channel is genuinely empty', async () => {
        // A body with no `<entry` at all is a channel that has published
        // nothing, which is not a failure and must not fail the run.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => feed('<feed></feed>')),
        );

        await expect(listVideos('chan', SINCE)).resolves.toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it('retries a transient 5xx rather than failing the source', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('upstream error', { status: 503 }))
            .mockResolvedValueOnce(
                feed(`<feed>${entry('abc123', '2026-09-11T19:33:39+00:00')}</feed>`),
            );
        vi.stubGlobal('fetch', fetchMock);

        const videos = listVideos('chan', SINCE);
        await vi.advanceTimersByTimeAsync(5_000);

        await expect(videos).resolves.toEqual([
            {
                id: 'abc123',
                url: 'https://www.youtube.com/watch?v=abc123',
                publishedAt: '2026-09-11T19:33:39+00:00',
            },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries a dropped connection', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));

        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error('socket hang up'))
            .mockResolvedValueOnce(
                feed(`<feed>${entry('abc123', '2026-09-11T19:33:39+00:00')}</feed>`),
            );
        vi.stubGlobal('fetch', fetchMock);

        const videos = listVideos('chan', SINCE);
        await vi.advanceTimersByTimeAsync(5_000);

        expect((await videos).map((v) => v.id)).toEqual(['abc123']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a response that will never succeed', async () => {
        // A deleted or mistyped channel id is a 404 every time, and retrying it
        // only delays the failure the run needs to report.
        const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(listVideos('chan', SINCE)).rejects.toThrow(/404/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('listVideos filtering and order', () => {
    const feed = (entries: { id: string; published: string }[]) =>
        `<feed>${entries
            .map(
                (e) =>
                    `<entry><yt:videoId>${e.id}</yt:videoId><published>${e.published}</published></entry>`,
            )
            .join('')}</feed>`;

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    function serving(xml: string) {
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(xml)));
    }

    it('does not announce a premiere that has not aired', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
        serving(
            feed([
                { id: 'aired', published: '2026-09-19T00:00:00Z' },
                { id: 'upcoming', published: '2026-09-25T00:00:00Z' },
            ]),
        );
        // Scheduled premieres and upcoming live streams appear in the feed
        // before they air, and announcing those is announcing nothing.
        const videos = await listVideos('chan', '2026-09-01T00:00:00Z');
        expect(videos.map((v) => v.id)).toEqual(['aired']);
    });

    it('drops anything older than the lookback window', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
        serving(
            feed([
                { id: 'stale', published: '2026-08-01T00:00:00Z' },
                { id: 'fresh', published: '2026-09-15T00:00:00Z' },
            ]),
        );
        const videos = await listVideos('chan', '2026-09-01T00:00:00Z');
        expect(videos.map((v) => v.id)).toEqual(['fresh']);
    });

    it('returns oldest first, which is how the watermark advances one step', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
        serving(
            feed([
                { id: 'newer', published: '2026-09-15T00:00:00Z' },
                { id: 'older', published: '2026-09-05T00:00:00Z' },
            ]),
        );
        // announceVideos slices MAX_PER_RUN off the front, so newest-first would
        // move the watermark to the top and strand everything between.
        const videos = await listVideos('chan', '2026-09-01T00:00:00Z');
        expect(videos.map((v) => v.id)).toEqual(['older', 'newer']);
    });
});

describe('a feed whose date format changed', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('fails loudly instead of dropping every video', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
        vi.stubGlobal('fetch', () =>
            Promise.resolve(
                new Response(
                    '<feed><entry><yt:videoId>abc</yt:videoId><published>20/09/2026</published></entry></feed>',
                ),
            ),
        );

        // The entries parse, so the <entry>-present guard does not fire. Every
        // Date.parse is NaN, both comparisons are false, and the whole feed is
        // dropped with no output - a green cron run and dead announcements.
        await expect(listVideos('chan', '2026-09-01T00:00:00Z')).rejects.toThrow(/feed format/i);
    });
});
