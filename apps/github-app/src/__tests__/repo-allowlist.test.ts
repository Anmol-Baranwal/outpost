import { describe, it, expect } from 'vitest';
import { isRepoAllowed } from '../lib/repo-allowlist.js';

describe('isRepoAllowed', () => {
    const allow = ['CopilotKit/CopilotKit'];

    it('allows an exact allowlisted repo', () => {
        expect(isRepoAllowed('CopilotKit/CopilotKit', allow)).toBe(true);
    });

    it('rejects a repo not on the allowlist (the outpost bug)', () => {
        expect(isRepoAllowed('CopilotKit/outpost', allow)).toBe(false);
    });

    it('matches case-insensitively', () => {
        expect(isRepoAllowed('copilotkit/copilotkit', allow)).toBe(true);
        expect(isRepoAllowed('CopilotKit/CopilotKit', ['copilotkit/copilotkit'])).toBe(true);
    });

    it('supports multiple allowlisted repos', () => {
        const multi = ['CopilotKit/CopilotKit', 'ag-ui-protocol/ag-ui'];
        expect(isRepoAllowed('ag-ui-protocol/ag-ui', multi)).toBe(true);
        expect(isRepoAllowed('CopilotKit/outpost', multi)).toBe(false);
    });

    it('rejects null/undefined/empty repo names', () => {
        expect(isRepoAllowed(null, allow)).toBe(false);
        expect(isRepoAllowed(undefined, allow)).toBe(false);
        expect(isRepoAllowed('', allow)).toBe(false);
    });

    it('allows all when the allowlist is empty (no restriction configured)', () => {
        expect(isRepoAllowed('anyone/anything', [])).toBe(true);
    });
});
