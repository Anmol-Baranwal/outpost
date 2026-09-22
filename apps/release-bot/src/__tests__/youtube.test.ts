import { describe, expect, it } from 'vitest';
import { parseFeed } from '../youtube.js';

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
