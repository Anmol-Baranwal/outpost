import { describe, it, expect, vi } from 'vitest';
import { samplingParams, supportsTemperature } from './model-capabilities.js';

describe('supportsTemperature', () => {
    // The four env-overridable defaults as they stand today. If any of these
    // regress to false, every AI call quietly loses the tuned temperature it was
    // calibrated against.
    it('accepts the models this package currently defaults to', () => {
        expect(supportsTemperature('claude-sonnet-4-6')).toBe(true);
        expect(supportsTemperature('claude-haiku-4-5-20251001')).toBe(true);
    });

    // Anthropic removed the sampling parameters on these; sending one is a 400.
    it.each([
        'claude-fable-5',
        'claude-mythos-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-sonnet-5',
    ])('rejects %s, which 400s on a temperature', (model) => {
        expect(supportsTemperature(model)).toBe(false);
    });

    // Deprecated but not retired, so still callable — and they do accept one.
    it('accepts the Claude 4.0 models that are deprecated but still callable', () => {
        expect(supportsTemperature('claude-opus-4-0')).toBe(true);
        expect(supportsTemperature('claude-sonnet-4-0')).toBe(true);
    });

    it('matches a dated snapshot by its base model', () => {
        expect(supportsTemperature('claude-sonnet-4-6-20260101')).toBe(true);
    });

    // The direction that matters: an unlisted model must fall on the side that
    // still produces a valid request. See the module docstring.
    it('treats an unknown model as not accepting one', () => {
        expect(supportsTemperature('claude-something-7')).toBe(false);
        expect(supportsTemperature('')).toBe(false);
    });

    it('does not match on a substring in the middle of a name', () => {
        expect(supportsTemperature('not-claude-sonnet-4-6')).toBe(false);
    });
});

describe('samplingParams', () => {
    it('carries the temperature through for a supporting model', () => {
        const onOmitted = vi.fn();
        expect(samplingParams('claude-sonnet-4-6', 0.3, onOmitted)).toEqual({ temperature: 0.3 });
        expect(onOmitted).not.toHaveBeenCalled();
    });

    // Asserted as an absent key, not an undefined one: `{temperature: undefined}`
    // serializes to `"temperature": null` through some JSON paths, which is a 400
    // on exactly the models this exists to protect.
    it('omits the key entirely for a rejecting model', () => {
        const result = samplingParams('claude-opus-5', 0.3, vi.fn());
        expect(result).toEqual({});
        expect('temperature' in result).toBe(false);
    });

    it('reports the omission so a silent sampling change leaves a trace', () => {
        const onOmitted = vi.fn();
        samplingParams('claude-opus-5', 0.3, onOmitted);
        expect(onOmitted).toHaveBeenCalledWith('claude-opus-5');
    });

    it('preserves a zero temperature rather than treating it as unset', () => {
        expect(samplingParams('claude-haiku-4-5', 0, vi.fn())).toEqual({ temperature: 0 });
    });
});

describe('the omission warning', () => {
    // One warning per request would mean thousands of identical lines a day for a
    // single env change — enough to bury the errors this log sits next to. The
    // condition is a property of the model, so once per model is all the
    // information there is.
    it('warns once per model rather than once per request', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // A model name unique to this test, so an earlier test in the file
            // cannot have already filled the dedupe set for it.
            const model = 'claude-warn-dedupe-probe-5';
            samplingParams(model, 0.3);
            samplingParams(model, 0.3);
            samplingParams(model, 0.3);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
    });
});
