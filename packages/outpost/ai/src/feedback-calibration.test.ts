import { describe, it, expect } from 'vitest';
import {
    computeCalibrationFactor,
    FEEDBACK_MAX_ADJUSTMENT,
    FEEDBACK_MIN_SAMPLE,
} from './feedback-calibration.js';

describe('computeCalibrationFactor', () => {
    it('returns 0 below the min-sample threshold', () => {
        expect(computeCalibrationFactor({ positives: 10, negatives: 5 })).toBe(0);
        expect(computeCalibrationFactor({ positives: 0, negatives: 0 })).toBe(0);
    });

    it('returns ~0 for a balanced tally at/above threshold', () => {
        const f = computeCalibrationFactor({ positives: 25, negatives: 25 });
        expect(Math.abs(f)).toBeLessThan(0.02);
    });

    it('saturates positive for an all-positive large tally', () => {
        expect(computeCalibrationFactor({ positives: 500, negatives: 0 })).toBeCloseTo(
            FEEDBACK_MAX_ADJUSTMENT,
            5,
        );
    });

    it('saturates negative for an all-negative large tally', () => {
        expect(computeCalibrationFactor({ positives: 0, negatives: 500 })).toBeCloseTo(
            -FEEDBACK_MAX_ADJUSTMENT,
            5,
        );
    });

    it('is monotonic in positives and always within bounds', () => {
        const a = computeCalibrationFactor({ positives: 30, negatives: 20 });
        const b = computeCalibrationFactor({ positives: 40, negatives: 10 });
        expect(b).toBeGreaterThan(a);
        for (const f of [a, b]) {
            expect(f).toBeGreaterThanOrEqual(-FEEDBACK_MAX_ADJUSTMENT);
            expect(f).toBeLessThanOrEqual(FEEDBACK_MAX_ADJUSTMENT);
        }
    });

    it('does not calibrate on a tally one short of the threshold', () => {
        expect(computeCalibrationFactor({ positives: FEEDBACK_MIN_SAMPLE - 1, negatives: 0 })).toBe(0);
    });
});
