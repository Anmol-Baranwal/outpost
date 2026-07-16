/**
 * Global feedback → confidence calibration.
 *
 * Maps an aggregate 👍/👎 tally to a bounded adjustment applied to FUTURE
 * response confidence scores. Pure and DB-free — the caller supplies the tally
 * (see getFeedbackCalibration in the queue package).
 */

/** Minimum feedback events before calibration engages (avoid calibrating on noise). */
export const FEEDBACK_MIN_SAMPLE = 20;
/** Maximum absolute adjustment applied to a confidence score. */
export const FEEDBACK_MAX_ADJUSTMENT = 0.15;
/** Scales the (ratio - 0.5) signal; tuned so the extremes saturate at the cap. */
export const FEEDBACK_SENSITIVITY = 0.6;

export interface FeedbackTally {
    positives: number;
    negatives: number;
}

/**
 * Compute a bounded confidence adjustment from an aggregate feedback tally.
 * Returns 0 until FEEDBACK_MIN_SAMPLE events exist. Result is always within
 * [-FEEDBACK_MAX_ADJUSTMENT, +FEEDBACK_MAX_ADJUSTMENT].
 */
export function computeCalibrationFactor(tally: FeedbackTally): number {
    const positives = Math.max(0, tally.positives);
    const negatives = Math.max(0, tally.negatives);
    const total = positives + negatives;

    if (total < FEEDBACK_MIN_SAMPLE) {
        return 0;
    }

    // Laplace-smoothed positive ratio keeps small tallies from swinging hard.
    const ratio = (positives + 1) / (total + 2);
    const raw = (ratio - 0.5) * FEEDBACK_SENSITIVITY;

    return Math.max(-FEEDBACK_MAX_ADJUSTMENT, Math.min(FEEDBACK_MAX_ADJUSTMENT, raw));
}
