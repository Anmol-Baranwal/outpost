import { describe, expect, it } from 'vitest';
import { SKIP_REPLY, SUBSTANTIVE } from '../summarize.js';

describe('SUBSTANTIVE', () => {
    it.each([
        'feat: add useAgent',
        'fix(runtime): stop dropping tool results',
        'perf: cut replay allocations',
        // Breaking changes are the releases that must never be silently skipped,
        // and `feat!:` has no parenthesis for the pattern to key on.
        'feat!: drop the useRenderTool shim',
        'fix!: rename the flag',
    ])('counts %s as shipped work', (subject) => {
        expect(SUBSTANTIVE.test(subject)).toBe(true);
    });

    it.each([
        'fix(docs): typo',
        'feat(doc): rewrite the guide',
        // Compound docs scopes reached the channel as feature announcements.
        'fix(docs/api): correct the example',
        'feat(docs,website): new landing page',
        'fix(deps): bump zod',
        'chore(deps): bump vitest',
        'ci: pin the runner',
        'docs: explain threads',
    ])('does not count %s', (subject) => {
        expect(SUBSTANTIVE.test(subject)).toBe(false);
    });
});

describe('SKIP_REPLY', () => {
    it.each(['SKIP', 'skip', 'SKIP.', '**SKIP**', '  SKIP  ', '`skip`', '- Skip.'])(
        'reads %s as the sentinel',
        (reply) => {
            expect(SKIP_REPLY.test(reply)).toBe(true);
        },
    );

    it.each([
        'SKIP this release because nothing shipped',
        '- You can now skip the setup step',
        'Skipping is now configurable',
    ])('does not read %s as the sentinel', (reply) => {
        // A near miss used to be posted verbatim as the announcement body.
        expect(SKIP_REPLY.test(reply)).toBe(false);
    });
});
