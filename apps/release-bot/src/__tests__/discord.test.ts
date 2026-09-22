import { describe, expect, it } from 'vitest';
import { MESSAGE_LIMIT, compose, sourceUrlOf } from '../discord.js';

const url = 'https://github.com/CopilotKit/CopilotKit/releases/tag/v1.73.0';

describe('compose', () => {
    it('keeps the message within Discord’s limit and ends with the source URL', () => {
        const content = compose({
            title: 'v1.73.0',
            body: 'a'.repeat(4000),
            footer: 'thanks someone for contributing :)',
            url,
        });

        expect(content.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
        expect(content.endsWith(url)).toBe(true);
    });

    it('still ends with the source URL when a role is pinged', () => {
        // The mention is ~24 characters. Budgeting without it used to push the
        // message over the limit and truncate the URL, which is the dedup key.
        const content = compose({
            title: 'v1.73.0',
            body: 'a'.repeat(4000),
            footer: 'thanks someone for contributing :)',
            url,
            pingRoleId: '1550206847087288480',
        });

        expect(content.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
        expect(content.endsWith(url)).toBe(true);
        expect(content.startsWith('<@&1550206847087288480> ')).toBe(true);
    });

    it('keeps the URL when the title and credit line leave no room for anything else', () => {
        // Sacrifice order: body, then credit line, then title. Never the URL.
        const content = compose({
            title: 'x'.repeat(1200),
            body: 'a'.repeat(500),
            footer: `thanks ${'contributor, '.repeat(60)}for contributing :)`,
            url,
        });

        expect(content.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
        expect(content.endsWith(url)).toBe(true);
    });

    it('keeps the URL even when the title alone exceeds the limit', () => {
        const content = compose({ title: 'x'.repeat(5000), body: 'body', url });
        expect(content.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
        expect(content.endsWith(url)).toBe(true);
    });

    it('leaves a short message untouched', () => {
        const content = compose({ title: 'v1.73.0', body: '- one thing shipped', url });
        expect(content).toBe(`**v1.73.0**\n\n- one thing shipped\n\n${url}`);
    });

    it('does not split a surrogate pair when trimming', () => {
        const content = compose({ title: 'v1.73.0', body: '🚀'.repeat(2000), url });
        expect(content.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
        // A lone high surrogate would be an unpaired code unit in the output.
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(content)).toBe(false);
    });
});

describe('sourceUrlOf', () => {
    it('reads the trailing URL', () => {
        expect(sourceUrlOf(`**v1.73.0**\n\n- shipped\n\n${url}`)).toBe(url);
    });

    it('ignores links inside the summary body', () => {
        // The summary is model-written and may mention other releases. Treating
        // those as announced would silently suppress them later.
        const content = `**v1.73.0**\n\nsee https://github.com/CopilotKit/CopilotKit/releases/tag/v1.72.0\n\n${url}`;
        expect(sourceUrlOf(content)).toBe(url);
    });

    it('returns nothing when the message does not end in a URL', () => {
        expect(sourceUrlOf('just a chat message')).toBeUndefined();
    });
});
