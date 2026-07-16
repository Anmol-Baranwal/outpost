import { computeCalibrationFactor } from '@copilotkit/outpost/ai';

/**
 * Minimal structural view of the Prisma client this reader needs. Keeps the
 * reader decoupled from the full PrismaClient type and trivially mockable.
 */
export interface FeedbackCountClient {
    message: {
        count(args: { where: Record<string, unknown> }): Promise<number>;
    };
}

/**
 * Read the aggregate 👍/👎 tally from persisted AI messages and map it to a
 * bounded confidence calibration factor. DB errors propagate — the caller
 * (ai-response handler) owns the single fail-soft fallback.
 */
export async function getFeedbackCalibration(prisma: FeedbackCountClient): Promise<number> {
    const [positives, negatives] = await Promise.all([
        prisma.message.count({ where: { isAiGenerated: true, feedback: 'POSITIVE' } }),
        prisma.message.count({ where: { isAiGenerated: true, feedback: 'NEGATIVE' } }),
    ]);
    return computeCalibrationFactor({ positives, negatives });
}
