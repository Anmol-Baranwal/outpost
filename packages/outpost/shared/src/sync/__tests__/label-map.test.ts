import { describe, it, expect, vi } from 'vitest';
import { loadLabelMapper } from '../label-map.js';

function makeDb(row: { key: string; value: string } | null) {
    return { systemConfig: { findUnique: vi.fn().mockResolvedValue(row) } };
}

describe('loadLabelMapper', () => {
    it('falls back to the hardcoded Linear mapper when no config row exists', async () => {
        const db = makeDb(null);
        const mapper = await loadLabelMapper('linear', db);

        // Linear default strips "Priority: "
        expect(mapper.toOutpost(['Priority: bug'])).toEqual(['bug']);
    });

    it('falls back to the hardcoded GitHub mapper when no config row exists', async () => {
        const db = makeDb(null);
        const mapper = await loadLabelMapper('github', db);

        // GitHub default strips "priority:" and excludes "wontfix"
        expect(mapper.toOutpost(['priority:high', 'wontfix'])).toEqual(['high']);
    });

    it('builds from persisted rules when present for the requested plugin', async () => {
        const config = {
            labelRules: {
                linear: [{ externalPrefix: 'X-', outpostPrefix: '' }],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const mapper = await loadLabelMapper('linear', db);

        expect(mapper.toOutpost(['X-foo'])).toEqual(['foo']);
        // The default "Priority: " rule was replaced, so that prefix is no longer stripped
        expect(mapper.toOutpost(['Priority: bar'])).toEqual(['Priority: bar']);
    });

    it('falls back to defaults when persisted config has no rules for this plugin', async () => {
        const config = {
            labelRules: { linear: [{ externalPrefix: 'X-', outpostPrefix: '' }] },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const mapper = await loadLabelMapper('github', db);

        expect(mapper.toOutpost(['priority:high'])).toEqual(['high']);
    });

    it('falls back to defaults when the persisted value is malformed JSON', async () => {
        const db = makeDb({ key: 'sync.mappingConfig', value: 'not json' });

        const mapper = await loadLabelMapper('linear', db);

        expect(mapper.toOutpost(['Priority: bug'])).toEqual(['bug']);
    });

    it('falls back to defaults when all persisted rules have a non-string prefix', async () => {
        const config = {
            labelRules: {
                linear: [{ externalPrefix: 123, outpostPrefix: null }],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const mapper = await loadLabelMapper('linear', db);

        // No valid rules → hardcoded default
        expect(mapper.toOutpost(['Priority: bug'])).toEqual(['bug']);
    });
});
